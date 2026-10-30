package learning

import (
	"teachem/api-go/internal/core"
)

func questionsGet(s core.Store, id string) ([]core.Row, error) {
	qs, e := s.Rows(`SELECT * FROM "Question" WHERE "testId"=$1 ORDER BY position,id`, id)
	if e != nil {
		return nil, e
	}
	for _, q := range qs {
		opts, e := s.Rows(`SELECT * FROM "AnswerOption" WHERE "questionId"=$1 ORDER BY position,id`, q["id"])
		if e != nil {
			return nil, e
		}
		q["options"] = opts
	}
	return qs, nil
}

func testGet(s core.Store, id string, includeDeleted bool) (core.Row, error) {
	var t core.Row
	var e error
	if includeDeleted {
		t, e = s.Find("Test", id)
	} else {
		t, e = live(s, "Test", id)
	}
	if e != nil {
		return nil, e
	}
	qs, e := questionsGet(s, id)
	if e != nil {
		return nil, e
	}
	t["questions"] = qs
	return t, nil
}

func insertQuestions(s core.Store, testID string, qs []core.Row) error {
	for i, q := range qs {
		entry := core.Pick(q, "text", "type", "points")
		entry["testId"] = testID
		entry["position"] = i
		r, e := s.Insert("Question", entry)
		if e != nil {
			return e
		}
		for j, o := range rows(q["options"]) {
			data := core.Pick(o, "text", "isCorrect")
			data["questionId"] = r["id"]
			data["position"] = j
			if _, e = s.Insert("AnswerOption", data); e != nil {
				return e
			}
		}
	}
	return nil
}

func testCreate(s core.Store, courseID, title string, qs []core.Row) (core.Row, error) {
	r, e := s.Insert("Test", core.Row{"courseId": courseID, "title": title})
	if e != nil {
		return nil, e
	}
	if e = insertQuestions(s, core.Str(r, "id"), qs); e != nil {
		return nil, e
	}
	return testGet(s, core.Str(r, "id"), false)
}

func attemptGet(s core.Store, id string) (core.Row, error) {
	a, e := s.Find("TestAttempt", id)
	if e != nil {
		return nil, e
	}
	t, e := testGet(s, core.Str(a, "testId"), true)
	if e != nil {
		return nil, e
	}
	a["test"] = t
	answers, e := s.Rows(`SELECT a.*,coalesce((SELECT jsonb_agg(o) FROM "AttemptAnswerOption" o WHERE o."attemptAnswerId"=a.id),'[]'::jsonb) AS selected FROM "AttemptAnswer" a WHERE a."attemptId"=$1 ORDER BY a.id`, id)
	if e != nil {
		return nil, e
	}
	a["answers"] = answers
	return a, nil
}
