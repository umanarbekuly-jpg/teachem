package learning

import (
	"teachem/api-go/internal/core"
)

func validateTest(d core.Row, partial bool) error {
	if e := text(d, "title", 2, 160, !partial); e != nil {
		return e
	}
	v, exists := d["questions"]
	if !exists && partial {
		return nil
	}
	qs, ok := v.([]any)
	if !ok || len(qs) < 1 || len(qs) > 50 {
		return core.Field("questions", "Нужно от 1 до 50 вопросов")
	}
	for _, v := range qs {
		q, ok := v.(map[string]any)
		if !ok {
			return core.Field("questions", "Некорректный вопрос")
		}
		if e := allowed(q, "text", "type", "points", "options"); e != nil {
			return e
		}
		if e := text(q, "text", 1, 3000, true); e != nil {
			return e
		}
		if e := integer(q, "points", 1, 1000, true); e != nil {
			return e
		}
		if core.Str(q, "type") != "single" && core.Str(q, "type") != "multiple" {
			return core.Field("type", "Некорректный тип вопроса")
		}
		os, ok := q["options"].([]any)
		if !ok || len(os) < 2 || len(os) > 10 {
			return core.Field("options", "Нужно от 2 до 10 вариантов")
		}
		correct := 0
		for _, v := range os {
			o, ok := v.(map[string]any)
			if !ok {
				return core.Field("options", "Некорректный вариант")
			}
			if e := allowed(o, "text", "isCorrect"); e != nil {
				return e
			}
			if e := text(o, "text", 1, 1000, true); e != nil {
				return e
			}
			b, ok := o["isCorrect"].(bool)
			if !ok {
				return core.Field("isCorrect", "Укажите правильный ответ")
			}
			if b {
				correct++
			}
		}
		if correct == 0 || (core.Str(q, "type") == "single" && correct != 1) {
			return core.Field("options", "Укажите правильные ответы для каждого вопроса")
		}
	}
	return nil
}

func validateAnswers(d core.Row) ([]core.Row, error) {
	v, ok := d["answers"].([]any)
	if !ok || len(v) > 50 {
		return nil, core.Field("answers", "Не более 50 ответов")
	}
	seen := map[string]bool{}
	out := []core.Row{}
	for _, v := range v {
		m, ok := v.(map[string]any)
		if !ok {
			return nil, core.Field("answers", "Некорректный ответ")
		}
		if e := allowed(m, "questionId", "optionIds"); e != nil {
			return nil, e
		}
		id := core.Str(m, "questionId")
		if !isUUID(id) || seen[id] {
			return nil, core.Field("questionId", "Некорректный или повторяющийся вопрос")
		}
		seen[id] = true
		ids, ok := stringsArray(m["optionIds"])
		if !ok || len(ids) > 10 {
			return nil, core.Field("optionIds", "Не более 10 вариантов")
		}
		os := map[string]bool{}
		for _, id := range ids {
			if !isUUID(id) || os[id] {
				return nil, core.Field("optionIds", "Некорректный или повторяющийся вариант")
			}
			os[id] = true
		}
		m["optionIds"] = ids
		out = append(out, m)
	}
	return out, nil
}
