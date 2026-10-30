package learning

import (
	"net/http/httptest"
	"strings"
	"teachem/api-go/internal/core"
	"testing"
)

func courseFixture() core.Row {
	return core.Row{"title": "Курс", "description": "Подробное описание курса для проверки", "subject": "  Вайбкодинг   для всех ", "durationDays": float64(45), "monthlyPriceMinor": float64(500000), "tags": []any{"#Код", "AI_2026", "Практика"}}
}
func TestCourseValidation(t *testing.T) {
	d := courseFixture()
	if err := validateCourse(d, true); err != nil {
		t.Fatal(err)
	}
	if d["subject"] != "Вайбкодинг для всех" {
		t.Fatal("subject spaces not normalized")
	}
	tags, _ := stringsArray(d["tags"])
	if tags[0] != "код" {
		t.Fatal("tag normalization")
	}
	for _, tags := range [][]any{{"a", "b", "c", "d"}, {"Код", "#код"}, {"with space"}, {"a-b"}, {"#"}, {"🙂"}} {
		d := courseFixture()
		d["tags"] = tags
		if validateCourse(d, true) == nil {
			t.Fatalf("accepted invalid tags %v", tags)
		}
	}
	for _, duration := range []any{float64(0), float64(-1), float64(1.5), "45", nil} {
		d := courseFixture()
		d["durationDays"] = duration
		if validateCourse(d, true) == nil {
			t.Fatalf("accepted invalid duration %v", duration)
		}
	}
	d = courseFixture()
	delete(d, "durationDays")
	delete(d, "tags")
	if err := validateCourse(d, true); err != nil {
		t.Fatalf("optional level, tags, duration: %v", err)
	}
	d = core.Row{"title": "New"}
	if err := validateCourse(d, false); err != nil {
		t.Fatal(err)
	}
}
func TestExactSetScoring(t *testing.T) {
	for _, x := range []struct {
		selected []string
		score    int
	}{{[]string{"a", "b"}, 7}, {[]string{"b", "a"}, 7}, {[]string{"a"}, 0}, {[]string{"a", "a"}, 0}, {[]string{"a", "b", "c"}, 0}, {[]string{}, 0}} {
		if got := scoreQuestion([]string{"a", "b"}, x.selected, 7); got != x.score {
			t.Fatalf("%v: got %d", x.selected, got)
		}
	}
}
func TestMeetingURL(t *testing.T) {
	for _, s := range []string{"http://meet.google.com/a", "https://meet.google.com.evil.test/a", "https://user:pass@meet.google.com/a", "javascript:alert(1)", "https://example.test/meet"} {
		if meetingURL(s) {
			t.Fatal("accepted unsafe meeting URL", s)
		}
	}
	if !meetingURL("https://meet.google.com/abc-defg-hij") {
		t.Fatal("valid meeting URL rejected")
	}
	for _, s := range []string{"https://meet.google.com/with space", "https://meet.google.com/" + strings.Repeat("a", 2100)} {
		if meetingURL(s) {
			t.Fatal("invalid meeting URL accepted")
		}
	}
}

func TestListQueryValidation(t *testing.T) {
	for _, query := range []string{"?role=SUPERADMIN", "?page=1&page=2", "?pageSize=10&studentId=other"} {
		c := &core.Context{R: httptest.NewRequest("GET", "http://localhost/"+query, nil)}
		if queryAllowed(c, []string{"page", "pageSize"}) == nil {
			t.Fatal("unexpected query accepted", query)
		}
	}
}
func questionFixture() core.Row {
	return core.Row{"title": "Проверка знаний", "questions": []any{map[string]any{"text": "Вопрос", "type": "single", "points": float64(3), "options": []any{map[string]any{"text": "Да", "isCorrect": true}, map[string]any{"text": "Нет", "isCorrect": false}}}}}
}
func TestQuestionValidation(t *testing.T) {
	d := questionFixture()
	if e := validateTest(d, false); e != nil {
		t.Fatal(e)
	}
	q := d["questions"].([]any)[0].(map[string]any)
	q["options"].([]any)[1].(map[string]any)["isCorrect"] = true
	if validateTest(d, false) == nil {
		t.Fatal("single choice accepted two correct answers")
	}
	q["type"] = "multiple"
	if e := validateTest(d, false); e != nil {
		t.Fatal(e)
	}
	q["points"] = float64(0)
	if validateTest(d, false) == nil {
		t.Fatal("zero points allowed")
	}
	if validateTest(core.Row{"title": "draft"}, true) != nil {
		t.Fatal("partial edit rejected")
	}
}
func TestForeignAnswersRejected(t *testing.T) {
	qid := core.NewID()
	oid := core.NewID()
	other := core.NewID()
	qs := []core.Row{{"id": qid, "type": "single", "options": []core.Row{{"id": oid}}}}
	if answersBelong(qs, []core.Row{{"questionId": qid, "optionIds": []string{oid}}}) != nil {
		t.Fatal("own option rejected")
	}
	for _, a := range []core.Row{{"questionId": qid, "optionIds": []string{other}}, {"questionId": other, "optionIds": []string{oid}}, {"questionId": qid, "optionIds": []string{oid, other}}} {
		if answersBelong(qs, []core.Row{a}) == nil {
			t.Fatal("foreign option accepted")
		}
	}
}
func TestAnswerDTORejectsDuplicateAndPrivilegedFields(t *testing.T) {
	id := core.NewID()
	o := core.NewID()
	for _, answer := range []map[string]any{{"questionId": id, "optionIds": []any{o, o}}, {"questionId": id, "optionIds": []any{o}, "awardedPoints": 100}, {"questionId": "not-uuid", "optionIds": []any{o}}} {
		if _, e := validateAnswers(core.Row{"answers": []any{answer}}); e == nil {
			t.Fatal("invalid answer accepted")
		}
	}
	if _, e := validateAnswers(core.Row{"answers": []any{}}); e != nil {
		t.Fatal(e)
	}
}
