package learning

import (
	"teachem/api-go/internal/core"
	"time"
)

func testOwned(c *core.Context, id string) (core.Row, error) {
	t, e := testGet(c.Store, id, false)
	if e != nil {
		return nil, e
	}
	if _, e = ownCourse(c, core.Str(t, "courseId")); e != nil {
		return nil, e
	}
	return t, nil
}
func attemptOwn(c *core.Context) (core.Row, error) {
	a, e := attemptGet(c.Store, c.ID())
	if e != nil {
		return nil, e
	}
	if core.Str(a, "studentId") != c.Actor.ID {
		return nil, core.Error(403, "Это не ваша попытка")
	}
	if _, e = access(c, core.Str(row(a["test"]), "courseId")); e != nil {
		return nil, e
	}
	return a, nil
}
func scoreQuestion(correct, selected []string, points int) int {
	if len(correct) != len(selected) {
		return 0
	}
	seen := map[string]bool{}
	for _, s := range selected {
		if seen[s] {
			return 0
		}
		seen[s] = true
	}
	for _, s := range correct {
		if !seen[s] {
			return 0
		}
	}
	return points
}
func answersBelong(qs, answers []core.Row) error {
	questions := map[string]core.Row{}
	for _, q := range qs {
		questions[core.Str(q, "id")] = q
	}
	for _, a := range answers {
		q, ok := questions[core.Str(a, "questionId")]
		if !ok {
			return core.Error(400, "Некорректный ответ")
		}
		ids, _ := stringsArray(a["optionIds"])
		if core.Str(q, "type") == "single" && len(ids) > 1 {
			return core.Error(400, "Некорректный ответ")
		}
		opts := map[string]bool{}
		for _, o := range rows(q["options"]) {
			opts[core.Str(o, "id")] = true
		}
		for _, id := range ids {
			if !opts[id] {
				return core.Error(400, "Некорректный ответ")
			}
		}
	}
	return nil
}
func registerTests(a *core.App) {
	a.Handle("GET", "/api/v1/courses/{id}/tests", "", func(c *core.Context) (any, error) {
		co, e := access(c, c.ID())
		if e != nil {
			return nil, e
		}
		extra := ""
		if core.Str(co, "tutorId") != c.Actor.ID && c.Actor.Role != "SUPERADMIN" {
			extra = ` AND t.status='published'`
		}
		return list(c, `SELECT t.id,t.title,t."courseId",t.status,t."createdAt",jsonb_build_object('questions',(SELECT count(*) FROM "Question" q WHERE q."testId"=t.id)) AS _count FROM "Test" t WHERE t."courseId"=$1 AND t."deletedAt" IS NULL`+extra+` ORDER BY t."createdAt" DESC,t.id`, c.ID())
	})
	a.Handle("POST", "/api/v1/courses/{id}/tests", "tutor", func(c *core.Context) (any, error) {
		if _, e := ownCourse(c, c.ID()); e != nil {
			return nil, e
		}
		d, e := c.Body("title", "questions")
		if e != nil {
			return nil, e
		}
		if e = validateTest(d, false); e != nil {
			return nil, e
		}
		return c.Store.Tx(func(s core.Store) (any, error) {
			return testCreate(s, c.ID(), core.Str(d, "title"), rows(d["questions"]))
		})
	})
	a.Handle("GET", "/api/v1/tests/{id}", "", func(c *core.Context) (any, error) {
		t, e := testGet(c.Store, c.ID(), false)
		if e != nil {
			return nil, e
		}
		co, e := access(c, core.Str(t, "courseId"))
		if e != nil {
			return nil, e
		}
		if core.Str(co, "tutorId") != c.Actor.ID && c.Actor.Role != "SUPERADMIN" {
			if core.Str(t, "status") != "published" {
				return nil, core.Error(403, "Тест не опубликован")
			}
			for _, q := range rows(t["questions"]) {
				opts := []core.Row{}
				for _, o := range rows(q["options"]) {
					opts = append(opts, core.Pick(o, "id", "text", "position"))
				}
				q["options"] = opts
			}
		}
		return t, nil
	})
	a.Handle("PATCH", "/api/v1/tests/{id}", "tutor", func(c *core.Context) (any, error) {
		if _, e := testOwned(c, c.ID()); e != nil {
			return nil, e
		}
		d, e := c.Body("title", "questions")
		if e != nil {
			return nil, e
		}
		if e = validateTest(d, true); e != nil {
			return nil, e
		}
		return c.Store.Tx(func(s core.Store) (any, error) {
			t, e := testGet(s, c.ID(), false)
			if e != nil {
				return nil, e
			}
			if core.Str(t, "status") != "draft" {
				return nil, core.Error(400, "Опубликованный тест нельзя менять. Создайте копию")
			}
			if v, ok := d["questions"]; ok {
				if _, e = s.Exec(`DELETE FROM "AnswerOption" WHERE "questionId" IN (SELECT id FROM "Question" WHERE "testId"=$1)`, c.ID()); e != nil {
					return nil, e
				}
				if _, e = s.Exec(`DELETE FROM "Question" WHERE "testId"=$1`, c.ID()); e != nil {
					return nil, e
				}
				if e = insertQuestions(s, c.ID(), rows(v)); e != nil {
					return nil, e
				}
			}
			if title, ok := d["title"]; ok {
				if _, e = s.Update("Test", c.ID(), core.Row{"title": title}); e != nil {
					return nil, e
				}
			}
			return testGet(s, c.ID(), false)
		})
	})
	a.Handle("POST", "/api/v1/tests/{id}/publish", "tutor", func(c *core.Context) (any, error) {
		if _, e := testOwned(c, c.ID()); e != nil {
			return nil, e
		}
		return c.Store.Tx(func(s core.Store) (any, error) {
			t, e := testGet(s, c.ID(), false)
			if e != nil {
				return nil, e
			}
			if core.Str(t, "status") != "draft" {
				return nil, core.Error(400, "Тест уже опубликован")
			}
			qs := rows(t["questions"])
			if len(qs) == 0 {
				return nil, core.Error(400, "Добавьте вопросы")
			}
			for _, q := range qs {
				correct := 0
				for _, o := range rows(q["options"]) {
					if core.Bool(o, "isCorrect") {
						correct++
					}
				}
				if correct == 0 || (core.Str(q, "type") == "single" && correct != 1) {
					return nil, core.Error(400, "Укажите правильные ответы")
				}
			}
			return s.Update("Test", c.ID(), core.Row{"status": "published"})
		})
	})
	a.Handle("POST", "/api/v1/tests/{id}/copy", "tutor", func(c *core.Context) (any, error) {
		t, e := testOwned(c, c.ID())
		if e != nil {
			return nil, e
		}
		title := []rune(core.Str(t, "title") + " — копия")
		if len(title) > 160 {
			title = title[:160]
		}
		return c.Store.Tx(func(s core.Store) (any, error) {
			return testCreate(s, core.Str(t, "courseId"), string(title), rows(t["questions"]))
		})
	})
	a.Handle("DELETE", "/api/v1/tests/{id}", "tutor", func(c *core.Context) (any, error) {
		if _, e := testOwned(c, c.ID()); e != nil {
			return nil, e
		}
		return c.Store.Update("Test", c.ID(), core.Row{"status": "archived", "deletedAt": time.Now()})
	})
	a.Handle("POST", "/api/v1/tests/{id}/attempts", "student", func(c *core.Context) (any, error) {
		t, e := testGet(c.Store, c.ID(), false)
		if e != nil {
			return nil, e
		}
		if _, e = access(c, core.Str(t, "courseId")); e != nil {
			return nil, e
		}
		if core.Str(t, "status") != "published" {
			return nil, core.Error(400, "Тест не опубликован")
		}
		max := 0
		for _, q := range rows(t["questions"]) {
			max += core.Int(q, "points")
		}
		return c.Store.Insert("TestAttempt", core.Row{"testId": c.ID(), "studentId": c.Actor.ID, "maxScore": max})
	})
	a.Handle("GET", "/api/v1/tests/{id}/attempts", "tutor", func(c *core.Context) (any, error) {
		if _, e := testOwned(c, c.ID()); e != nil {
			return nil, e
		}
		return attemptsList(c, true)
	})
	a.Handle("GET", "/api/v1/test-attempts/me", "student", func(c *core.Context) (any, error) { return attemptsList(c, false) })
	a.Handle("GET", "/api/v1/test-attempts/{id}", "", func(c *core.Context) (any, error) {
		attempt, e := attemptGet(c.Store, c.ID())
		if e != nil {
			return nil, e
		}
		if core.Str(attempt, "studentId") != c.Actor.ID {
			if _, e = ownCourse(c, core.Str(row(attempt["test"]), "courseId")); e != nil {
				return nil, e
			}
		}
		result := core.Pick(attempt, "id", "testId", "studentId", "status", "score", "maxScore", "submittedAt")
		answers := []core.Row{}
		for _, ans := range rows(attempt["answers"]) {
			ids := []string{}
			for _, o := range rows(ans["selected"]) {
				ids = append(ids, core.Str(o, "answerOptionId"))
			}
			answers = append(answers, core.Row{"questionId": ans["questionId"], "optionIds": ids, "awardedPoints": ans["awardedPoints"]})
		}
		result["answers"] = answers
		return result, nil
	})
	a.Handle("PUT", "/api/v1/test-attempts/{id}/answers", "student", saveAnswers)
	a.Handle("POST", "/api/v1/test-attempts/{id}/submit", "student", submitAttempt)
}
func attemptsList(c *core.Context, byTest bool) (any, error) {
	where := `a."studentId"=$1`
	id := c.Actor.ID
	if byTest {
		where = `a."testId"=$1`
		id = c.ID()
	}
	return list(c, `SELECT a.id,a."testId",a."studentId",a.status,a.score,a."maxScore",a."submittedAt",jsonb_build_object('title',t.title,'courseId',t."courseId") AS test,jsonb_build_object('name',u.name) AS student FROM "TestAttempt" a JOIN "Test" t ON t.id=a."testId" JOIN "User" u ON u.id=a."studentId" WHERE `+where+` ORDER BY a."createdAt" DESC,a.id`, id)
}
func saveAnswers(c *core.Context) (any, error) {
	if _, e := attemptOwn(c); e != nil {
		return nil, e
	}
	d, e := c.Body("answers")
	if e != nil {
		return nil, e
	}
	answers, e := validateAnswers(d)
	if e != nil {
		return nil, e
	}
	return c.Store.Tx(func(s core.Store) (any, error) {
		attempt, e := attemptGet(s, c.ID())
		if e != nil {
			return nil, e
		}
		if core.Str(attempt, "status") != "in_progress" {
			return nil, core.Error(400, "Попытка завершена")
		}
		if e = answersBelong(rows(row(attempt["test"])["questions"]), answers); e != nil {
			return nil, e
		}
		if _, e = s.Exec(`DELETE FROM "AttemptAnswer" WHERE "attemptId"=$1`, c.ID()); e != nil {
			return nil, e
		}
		for _, ans := range answers {
			r, e := s.Insert("AttemptAnswer", core.Row{"attemptId": c.ID(), "questionId": ans["questionId"]})
			if e != nil {
				return nil, e
			}
			ids, _ := stringsArray(ans["optionIds"])
			for _, id := range ids {
				if _, e = s.Insert("AttemptAnswerOption", core.Row{"attemptAnswerId": r["id"], "answerOptionId": id}); e != nil {
					return nil, e
				}
			}
		}
		return core.OK(), nil
	})
}
func submitAttempt(c *core.Context) (any, error) {
	if _, e := attemptOwn(c); e != nil {
		return nil, e
	}
	return c.Store.Tx(func(s core.Store) (any, error) {
		attempt, e := attemptGet(s, c.ID())
		if e != nil {
			return nil, e
		}
		if core.Str(attempt, "status") == "submitted" {
			return core.Pick(attempt, "id", "score", "maxScore", "status"), nil
		}
		questions := map[string]core.Row{}
		for _, q := range rows(row(attempt["test"])["questions"]) {
			questions[core.Str(q, "id")] = q
		}
		score := 0
		for _, ans := range rows(attempt["answers"]) {
			q, ok := questions[core.Str(ans, "questionId")]
			if !ok {
				return nil, core.Error(409, "Структура теста изменилась")
			}
			correct := []string{}
			for _, o := range rows(q["options"]) {
				if core.Bool(o, "isCorrect") {
					correct = append(correct, core.Str(o, "id"))
				}
			}
			selected := []string{}
			for _, o := range rows(ans["selected"]) {
				selected = append(selected, core.Str(o, "answerOptionId"))
			}
			points := scoreQuestion(correct, selected, core.Int(q, "points"))
			score += points
			if _, e = s.Update("AttemptAnswer", core.Str(ans, "id"), core.Row{"awardedPoints": points}); e != nil {
				return nil, e
			}
		}
		return s.Update("TestAttempt", c.ID(), core.Row{"status": "submitted", "score": score, "submittedAt": time.Now()})
	})
}
