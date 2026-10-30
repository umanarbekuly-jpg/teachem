package commerce

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"image"
	"image/png"
	"teachem/api-go/internal/core"
	"testing"
)

func TestPayoutRoundingAndLargeAmounts(t *testing.T) {
	for _, test := range []struct{ amount, bps, gross, commission, net int64 }{{10001, 1234, 10001, 1234, 8767}, {1000000000, 10000, 1000000000, 1000000000, 0}, {100, 0, 100, 0, 100}} {
		gross, commission, net := calculatePayout(test.amount, test.bps)
		if gross != test.gross || commission != test.commission || net != test.net {
			t.Fatalf("payout mismatch for %d/%d: %d/%d/%d", test.amount, test.bps, gross, commission, net)
		}
	}
}
func TestRealCoverDecodeRejectsForgedHeadersAndWrongMime(t *testing.T) {
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	if !validSignature(b.Bytes(), ".png") {
		t.Fatal("PNG signature rejected")
	}
	if err := validateCover(b.Bytes(), "image/png"); err != nil {
		t.Fatal(err)
	}
	if err := validateCover(b.Bytes(), "image/jpeg"); err == nil {
		t.Fatal("mismatched MIME accepted")
	}
	if err := validateCover([]byte{137, 80, 78, 71, 13, 10, 26, 10}, "image/png"); err == nil {
		t.Fatal("forged header accepted")
	}
	if err := validateCover([]byte{255, 216, 255}, "image/jpeg"); err == nil {
		t.Fatal("truncated JPEG accepted")
	}
}

func TestWebPChecksActualFrameBeforePixelAllocation(t *testing.T) {
	for _, encoded := range []string{
		"UklGRk4AAABXRUJQVlA4WAoAAAAQAAAAAQAAAQAAQUxQSAUAAAAAgICAgABWUDggIgAAAHABAJ0BKgIAAgABQCYllAJ0AUAAAP78N4FX99ToPivgAAA=",
		"UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQuebXov+BiOh/AAA=",
		// Extended transparent lossless WebP with EXIF metadata.
		"UklGRgIBAABXRUJQVlA4WAoAAAAYAAAAAQAAAQAAVlA4TA8AAAAvAUAAEAcQ/Y8CBiKi/wEARVhJRswAAABFeGlmAABJSSoACAAAAAcAEgEDAAEAAAABAAAAGgEFAAEAAABiAAAAGwEFAAEAAABqAAAAKAEDAAEAAAACAAAAOwECAAUAAAByAAAAEwIDAAEAAAABAAAAaYcEAAEAAAB4AAAAAAAAADhjAADoAwAAOGMAAOgDAAB0ZXN0AAAGAACQBwAEAAAAMDIxMAGRBwAEAAAAAQIDAACgBwAEAAAAMDEwMAGgAwABAAAA//8AAAKgBAABAAAAAgAAAAOgBAABAAAAAgAAAAAAAAA=",
	} {
		body, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			t.Fatal(err)
		}
		if err = validateCover(body, "image/webp"); err != nil {
			t.Fatal(err)
		}
	}
	// 1x1 advertised VP8X canvas followed by an actual 16384x16384 VP8L header.
	// The body need not contain pixels: rejection must happen before Decode.
	var chunks bytes.Buffer
	chunks.WriteString("VP8X")
	_ = binary.Write(&chunks, binary.LittleEndian, uint32(10))
	chunks.Write(make([]byte, 10))
	chunks.WriteString("VP8L")
	_ = binary.Write(&chunks, binary.LittleEndian, uint32(5))
	chunks.WriteByte(0x2f)
	_ = binary.Write(&chunks, binary.LittleEndian, uint32(0x3fff|(0x3fff<<14)))
	chunks.WriteByte(0)
	var body bytes.Buffer
	body.WriteString("RIFF")
	_ = binary.Write(&body, binary.LittleEndian, uint32(4+chunks.Len()))
	body.WriteString("WEBP")
	body.Write(chunks.Bytes())
	if _, err := firstWebPFrame(body.Bytes(), 1, 1); err == nil {
		t.Fatal("forged canvas bypassed actual frame dimensions")
	}
}

func TestAnimatedWebPFirstFrameAndBounds(t *testing.T) {
	for _, encoded := range []string{
		// Two lossless frames.
		"UklGRoQAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAD/////AABBTk1GKAAAAAAAAAAAAAEAAAEAAGQAAAJWUDhMDwAAAC8BQAAABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAEAAAEAAGQAAABWUDhMDwAAAC8BQAAABxDR//4HIqL/AQA=",
		// Two lossy frames with separate alpha planes.
		"UklGRt4AAABXRUJQVlA4WAoAAAASAAAAAQAAAQAAQU5JTQYAAAD/////AABBTk1GVgAAAAAAAAAAAAEAAAEAAGQAAAJBTFBIBQAAAACAgICAAFZQOCAwAAAA0AEAnQEqAgACAAFAJiWgAnS6AfgAA7AA/vLrf/zYFc1z7/f/0uD9Lg/S4P/SkAAAQU5NRlQAAAAAAAAAAAABAAABAABkAAACQUxQSAUAAAAAgICAgABWUDggLgAAAJABAJ0BKgIAAgABQCYloAJ0ugADmAD++1Xj/6XB/9Lg/+lwf+lwfxuyzhukAAA=",
	} {
		body, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			t.Fatal(err)
		}
		if err := validateCover(body, "image/webp"); err != nil {
			t.Fatalf("valid animation rejected: %v", err)
		}
		broken := append([]byte(nil), body...)
		frame := bytes.LastIndex(broken, []byte("ANMF"))
		if frame < 0 {
			t.Fatal("missing fixture frame")
		}
		// The second frame must fit the canvas even though only the first frame
		// is pixel-decoded, just as with the former sharp default-page check.
		broken[frame+8] = 2
		if err := validateCover(broken, "image/webp"); err == nil {
			t.Fatal("out-of-canvas later animation frame accepted")
		}
		if len(body) > 50 {
			if err := validateCover(body[:50], "image/webp"); err == nil {
				t.Fatal("truncated animation accepted")
			}
		}
	}
}
func officeZip(t *testing.T, names []string) []byte {
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for _, name := range names {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = f.Write([]byte("<xml/>")); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func TestOfficeSignaturesRequireCorrectPartsAndRejectMacros(t *testing.T) {
	doc := officeZip(t, []string{"[Content_Types].xml", "word/document.xml"})
	if !validSignature(doc, ".docx") {
		t.Fatal("valid document rejected")
	}
	if validSignature(doc, ".pptx") {
		t.Fatal("document accepted as presentation")
	}
	if validSignature(officeZip(t, []string{"word/document.xml"}), ".docx") {
		t.Fatal("missing content types accepted")
	}
	if validSignature(officeZip(t, []string{"[Content_Types].xml", "word/document.xml", "word/VbaProject.Bin"}), ".docx") {
		t.Fatal("macro accepted")
	}
	if validSignature([]byte("PK broken"), ".docx") {
		t.Fatal("broken archive accepted")
	}
	if validSignature([]byte("not a PDF"), ".pdf") {
		t.Fatal("invalid PDF accepted")
	}
}
func TestNumericAndIdentifierValidation(t *testing.T) {
	for _, v := range []any{nil, "200", 1.5, -1.0, 10001.0} {
		if _, err := integerField(core.Row{"commissionBps": v}, "commissionBps", 0, 10000); err == nil {
			t.Fatalf("invalid numeric accepted: %v", v)
		}
	}
	if _, err := integerField(core.Row{"commissionBps": float64(1000)}, "commissionBps", 0, 10000); err != nil {
		t.Fatal(err)
	}
	if _, err := uuidField(core.Row{"id": "x' OR true --"}, "id", false); err == nil {
		t.Fatal("invalid id accepted")
	}
	if _, err := uuidField(core.Row{}, "id", false); err == nil {
		t.Fatal("missing id accepted")
	}
	if _, err := uuidField(core.Row{}, "id", true); err != nil {
		t.Fatal(err)
	}
}
