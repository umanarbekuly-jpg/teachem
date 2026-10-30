package commerce

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"

	"golang.org/x/image/riff"
	"golang.org/x/image/vp8"
)

var errWebPFrame = errors.New("invalid WebP frame")

func little24(b []byte) int {
	return int(b[0]) | int(b[1])<<8 | int(b[2])<<16
}

func writeWebPChunk(out *bytes.Buffer, id string, body []byte) {
	out.WriteString(id)
	_ = binary.Write(out, binary.LittleEndian, uint32(len(body)))
	out.Write(body)
	if len(body)%2 != 0 {
		out.WriteByte(0)
	}
}

func webPContainer(chunks []byte) []byte {
	var out bytes.Buffer
	out.WriteString("RIFF")
	_ = binary.Write(&out, binary.LittleEndian, uint32(len(chunks)+4))
	out.WriteString("WEBP")
	out.Write(chunks)
	return out.Bytes()
}

// DecodeConfig trusts VP8X canvas dimensions, while Decode allocates according
// to VP8/VP8L dimensions. Check actual frames before any pixel allocation.
func checkedWebPFrame(id string, frame, alpha []byte, width, height int) ([]byte, error) {
	w, h := 0, 0
	switch id {
	case "VP8 ":
		d := vp8.NewDecoder()
		d.Init(bytes.NewReader(frame), len(frame))
		header, err := d.DecodeFrameHeader()
		if err != nil {
			return nil, err
		}
		w, h = header.Width, header.Height
	case "VP8L":
		if len(frame) < 5 || frame[0] != 0x2f || alpha != nil {
			return nil, errWebPFrame
		}
		bits := binary.LittleEndian.Uint32(frame[1:5])
		if bits>>29 != 0 {
			return nil, errWebPFrame
		}
		w, h = int(bits&0x3fff)+1, int((bits>>14)&0x3fff)+1
	default:
		return nil, errWebPFrame
	}
	if w != width || h != height || w < 1 || h < 1 || int64(w)*int64(h) > 40000000 {
		return nil, errWebPFrame
	}
	var chunks bytes.Buffer
	if alpha != nil {
		if len(alpha) == 0 {
			return nil, errWebPFrame
		}
		header := make([]byte, 10)
		header[0] = 0x10
		for i := 0; i < 3; i++ {
			header[4+i] = byte((w - 1) >> (8 * i))
			header[7+i] = byte((h - 1) >> (8 * i))
		}
		writeWebPChunk(&chunks, "VP8X", header)
		writeWebPChunk(&chunks, "ALPH", alpha)
	}
	writeWebPChunk(&chunks, id, frame)
	return webPContainer(chunks.Bytes()), nil
}

func animationWebPFrame(body []byte, canvasWidth, canvasHeight int) ([]byte, error) {
	if len(body) < 16 {
		return nil, errWebPFrame
	}
	x, y := little24(body[0:3])*2, little24(body[3:6])*2
	w, h := little24(body[6:9])+1, little24(body[9:12])+1
	if x+w > canvasWidth || y+h > canvasHeight || int64(w)*int64(h) > 40000000 || body[15]&0xfc != 0 {
		return nil, errWebPFrame
	}
	_, reader, err := riff.NewReader(bytes.NewReader(webPContainer(body[16:])))
	if err != nil {
		return nil, err
	}
	var alpha, result []byte
	for {
		id, _, chunk, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(chunk)
		if err != nil {
			return nil, err
		}
		switch string(id[:]) {
		case "ALPH":
			if alpha != nil || result != nil || len(data) == 0 {
				return nil, errWebPFrame
			}
			alpha = data
		case "VP8 ", "VP8L":
			if result != nil {
				return nil, errWebPFrame
			}
			result, err = checkedWebPFrame(string(id[:]), data, alpha, w, h)
			if err != nil {
				return nil, err
			}
		default:
			return nil, errWebPFrame
		}
	}
	if result == nil {
		return nil, errWebPFrame
	}
	return result, nil
}

// First-frame decoding preserves animated WebP acceptance without decoding an
// unbounded number of animation frames. All frame headers and bounds are still
// checked. Original file bytes, including animation and metadata, are retained.
func firstWebPFrame(body []byte, width, height int) ([]byte, error) {
	form, reader, err := riff.NewReader(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	if string(form[:]) != "WEBP" || width < 1 || height < 1 || int64(width)*int64(height) > 40000000 {
		return nil, errWebPFrame
	}
	var first, alpha []byte
	extended, animated, animationHeader := false, false, false
	for {
		id, _, chunk, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(chunk)
		if err != nil {
			return nil, err
		}
		switch string(id[:]) {
		case "VP8X":
			if extended || first != nil || len(data) != 10 || little24(data[4:7])+1 != width || little24(data[7:10])+1 != height {
				return nil, errWebPFrame
			}
			extended, animated = true, data[0]&2 != 0
		case "ANIM":
			if !animated || animationHeader || first != nil || len(data) != 6 {
				return nil, errWebPFrame
			}
			animationHeader = true
		case "ANMF":
			if !animationHeader || alpha != nil {
				return nil, errWebPFrame
			}
			frame, err := animationWebPFrame(data, width, height)
			if err != nil {
				return nil, err
			}
			if first == nil {
				first = frame
			}
		case "ALPH":
			if animated || !extended || alpha != nil || first != nil || len(data) == 0 {
				return nil, errWebPFrame
			}
			alpha = data
		case "VP8 ", "VP8L":
			if animated || first != nil {
				return nil, errWebPFrame
			}
			first, err = checkedWebPFrame(string(id[:]), data, alpha, width, height)
			if err != nil {
				return nil, err
			}
		}
	}
	if first == nil {
		return nil, errWebPFrame
	}
	return first, nil
}
