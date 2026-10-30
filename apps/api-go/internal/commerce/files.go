package commerce

import (
	"archive/zip"
	"bytes"
	_ "golang.org/x/image/webp"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"path"
	"strings"
	"teachem/api-go/internal/core"
	"time"
)

const maxFileBytes = 20 * 1024 * 1024
const maxCoverBytes = 5 * 1024 * 1024

var fileTypes = map[string]string{
	".pdf":  "application/pdf",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".jpg":  "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
}

func validSignature(body []byte, ext string) bool {
	switch ext {
	case ".pdf":
		return bytes.HasPrefix(body, []byte("%PDF-"))
	case ".png":
		return bytes.HasPrefix(body, []byte{137, 80, 78, 71, 13, 10, 26, 10})
	case ".jpg", ".jpeg":
		return bytes.HasPrefix(body, []byte{255, 216, 255})
	case ".webp":
		return len(body) >= 12 && string(body[:4]) == "RIFF" && string(body[8:12]) == "WEBP"
	case ".docx", ".pptx":
		reader, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
		if err != nil {
			return false
		}
		var expanded uint64
		manifest, document := false, false
		target := "word/document.xml"
		if ext == ".pptx" {
			target = "ppt/presentation.xml"
		}
		for _, file := range reader.File {
			if file.UncompressedSize64 > 100*1024*1024-expanded {
				return false
			}
			expanded += file.UncompressedSize64
			if strings.HasSuffix(strings.ToLower(file.Name), "vbaproject.bin") {
				return false
			}
			if file.Name == "[Content_Types].xml" {
				manifest = true
			}
			if file.Name == target {
				document = true
			}
		}
		return manifest && document
	}
	return false
}
func validateCover(body []byte, mime string) error {
	config, format, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 40000000 || ("image/"+format) != mime {
		return core.Error(400, "Не удалось прочитать изображение JPEG, PNG или WebP (до 40 млн пикселей)")
	}
	if format != "jpeg" && format != "png" && format != "webp" {
		return core.Error(400, "Недопустимый формат обложки")
	}
	if format == "webp" {
		// The generic decoder does not support animation or some extended VP8L
		// files. Validate every frame header, then decode the first actual frame,
		// matching the previous sharp validator's default first-page behavior.
		body, err = firstWebPFrame(body, config.Width, config.Height)
		if err != nil {
			return core.Error(400, "Некорректные размеры кадра WebP")
		}
	}
	if _, _, err = image.Decode(bytes.NewReader(body)); err != nil {
		return core.Error(400, "Не удалось прочитать изображение JPEG, PNG или WebP")
	}
	return nil
}

func upload(c *core.Context) (any, error) {
	d, err := c.Body("purpose", "originalName", "mimeType", "sizeBytes")
	if err != nil {
		return nil, err
	}
	purpose, err := textField(d, "purpose", 1, 30)
	if err != nil {
		return nil, err
	}
	if purpose != "avatar" && purpose != "material" && purpose != "receipt" && purpose != "course_cover" {
		return nil, core.Field("purpose", "Недопустимое назначение файла")
	}
	name, err := textField(d, "originalName", 1, 200)
	if err != nil {
		return nil, err
	}
	mime, err := textField(d, "mimeType", 1, 150)
	if err != nil {
		return nil, err
	}
	size, err := integerField(d, "sizeBytes", 1, maxFileBytes)
	if err != nil {
		return nil, err
	}
	if purpose == "course_cover" && size > maxCoverBytes {
		return nil, core.Error(400, "Обложка должна быть не больше 5 МБ")
	}
	ext := strings.ToLower(path.Ext(name))
	if fileTypes[ext] != mime || ((purpose == "avatar" || purpose == "course_cover") && !strings.HasPrefix(mime, "image/")) || (purpose == "receipt" && ext != ".pdf" && ext != ".png" && ext != ".jpg" && ext != ".jpeg" && ext != ".webp") {
		return nil, core.Error(400, "Недопустимый формат файла")
	}
	if purpose != "receipt" && c.Actor.Role != "tutor" && !(c.Actor.Role == "SUPERADMIN" && (purpose == "avatar" || purpose == "course_cover")) {
		return nil, core.Error(403, "Загрузка доступна тьютору")
	}
	key := "pending/" + core.NewID() + ext
	f, err := c.Store.Insert("FileAsset", core.Row{"ownerId": c.Actor.ID, "purpose": purpose, "originalName": name, "mimeType": mime, "sizeBytes": size, "objectKey": key, "expiresAt": time.Now().UTC().Add(time.Hour)})
	if err != nil {
		return nil, err
	}
	result, err := c.App.Storage.Upload(c.R.Context(), key, mime, size)
	if err != nil {
		return nil, err
	}
	result["id"] = f["id"]
	return result, nil
}
func ownedFile(s core.Store, id, owner, purpose string) (core.Row, error) {
	f, err := s.Find("FileAsset", id)
	if err != nil {
		return nil, err
	}
	if core.Str(f, "ownerId") != owner || core.Str(f, "status") != "ready" || core.Str(f, "purpose") != purpose {
		return nil, core.Error(400, "Файл недоступен или не проверен")
	}
	return f, nil
}
func complete(c *core.Context) (any, error) {
	if _, err := c.Body(); err != nil {
		return nil, err
	}
	f, err := c.Store.Find("FileAsset", c.ID())
	if err != nil {
		return nil, err
	}
	if core.Str(f, "ownerId") != c.Actor.ID {
		return nil, core.Error(403, "Нет доступа к файлу")
	}
	if core.Str(f, "status") == "ready" {
		return core.Row{"id": c.ID(), "status": "ready"}, nil
	}
	expires, parseErr := time.Parse(time.RFC3339Nano, core.Str(f, "expiresAt"))
	if core.Str(f, "status") != "pending" || parseErr != nil || !expires.After(time.Now()) {
		return nil, core.Error(400, "Загрузка истекла")
	}
	key, mime := core.Str(f, "objectKey"), core.Str(f, "mimeType")
	size, remoteMime, err := c.App.Storage.Inspect(c.R.Context(), key)
	if err != nil {
		return nil, err
	}
	max := maxFileBytes
	if core.Str(f, "purpose") == "course_cover" {
		max = maxCoverBytes
	}
	reject := func(message string) (any, error) {
		_, err := c.Store.Exec(`UPDATE "FileAsset" SET status='rejected',"updatedAt"=now() WHERE id=$1 AND status='pending'`, c.ID())
		if err != nil {
			return nil, err
		}
		return nil, core.Error(400, message)
	}
	if size != int64(core.Int(f, "sizeBytes")) || size > int64(max) || mime != remoteMime {
		return reject("Размер или тип файла не совпадает")
	}
	body, err := c.App.Storage.Read(c.R.Context(), key, int64(max))
	if err != nil {
		return reject("Не удалось прочитать файл")
	}
	ext := strings.ToLower(path.Ext(core.Str(f, "originalName")))
	if len(body) != core.Int(f, "sizeBytes") || !validSignature(body, ext) {
		return reject("Содержимое файла не соответствует формату")
	}
	if core.Str(f, "purpose") == "course_cover" {
		if err = validateCover(body, mime); err != nil {
			return reject("Не удалось прочитать изображение JPEG, PNG или WebP (до 40 млн пикселей)")
		}
	}
	// Ready objects have an independent key, so a valid pending POST cannot replace them.
	readyKey := "ready/" + core.NewID() + ext
	if err = c.App.Storage.Put(c.R.Context(), readyKey, body, mime); err != nil {
		return nil, err
	}
	var changed int64
	result, err := c.Store.Tx(func(s core.Store) (any, error) {
		n, err := s.Exec(`UPDATE "FileAsset" SET status='ready',"objectKey"=$2,"expiresAt"=NULL,"updatedAt"=now() WHERE id=$1 AND status='pending' AND "expiresAt">now()`, c.ID(), readyKey)
		if err != nil {
			return nil, err
		}
		changed = n
		current, err := s.Find("FileAsset", c.ID())
		if err != nil {
			return nil, err
		}
		if core.Str(current, "status") != "ready" {
			return nil, core.Error(400, "Загрузка истекла")
		}
		return core.Row{"id": c.ID(), "status": "ready"}, nil
	})
	if err != nil || changed == 0 {
		_ = c.App.Storage.Delete(c.R.Context(), readyKey)
	}
	if err != nil {
		return nil, err
	}
	_ = c.App.Storage.Delete(c.R.Context(), key)
	return result, nil
}
func download(c *core.Context) (any, error) {
	f, err := c.Store.Find("FileAsset", c.ID())
	if err != nil {
		return nil, err
	}
	if core.Str(f, "status") != "ready" {
		return nil, core.Error(400, "Файл не готов")
	}
	if core.Str(f, "ownerId") != c.Actor.ID && c.Actor.Role != "SUPERADMIN" {
		bindings, err := c.Store.Rows(`SELECT "courseId" FROM "Material" WHERE "fileAssetId"=$1 AND "deletedAt" IS NULL`, c.ID())
		if err != nil {
			return nil, err
		}
		allowed := false
		for _, binding := range bindings {
			if _, err := c.App.Access(c, core.Str(binding, "courseId")); err == nil {
				allowed = true
				break
			}
		}
		if !allowed {
			return nil, core.Error(403, "Нет доступа к файлу")
		}
	}
	url, err := c.App.Storage.Download(c.R.Context(), core.Str(f, "objectKey"), core.Str(f, "originalName"))
	if err != nil {
		return nil, err
	}
	return core.Row{"url": url}, nil
}
