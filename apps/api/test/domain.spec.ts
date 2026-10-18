import {
  accessStatus,
  extendAccess,
} from "../src/modules/enrollments/enrollments.module";
import { calculatePayout } from "../src/modules/payouts/payouts.module";
import { scoreQuestion } from "../src/modules/tests/tests.service";
import { validSignature } from "../src/modules/materials/files.module";
import { ManualMeetLink } from "../src/modules/sessions/sessions.module";
import { zipSync, strToU8 } from "fflate";
describe("Доступ к курсу", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  it("даёт ровно 30 дней после первой оплаты", () =>
    expect(extendAccess(null, now).toISOString()).toBe(
      "2026-11-17T12:00:00.000Z",
    ));
  it("сохраняет оставшийся оплаченный срок", () =>
    expect(
      extendAccess(new Date("2026-11-01T12:00:00Z"), now).toISOString(),
    ).toBe("2026-12-01T12:00:00.000Z"));
  it("не продлевает от давно истёкшей даты", () =>
    expect(extendAccess(new Date("2020-01-01"), now)).toEqual(
      extendAccess(null, now),
    ));
  it("закрывает доступ на точной границе срока", () =>
    expect(accessStatus(now, now)).toBe("expired"));
  it("не выдаёт неоплаченный доступ", () =>
    expect(accessStatus(null, now)).toBe("inactive"));
});
describe("Деньги", () => {
  it("округляет комиссию вниз и сохраняет баланс", () =>
    expect(calculatePayout(10001, 1250)).toEqual({
      grossMinor: 10001,
      commissionMinor: 1250,
      netMinor: 8751,
    }));
  it("поддерживает нулевую и полную комиссию", () => {
    expect(calculatePayout(100, 0).netMinor).toBe(100);
    expect(calculatePayout(100, 10000).netMinor).toBe(0);
  });
});
describe("Результаты теста", () => {
  it("не зависит от порядка вариантов", () =>
    expect(scoreQuestion(["a", "b"], ["b", "a"], 5)).toBe(5));
  it.each([
    [["a"], ["a", "b"]],
    [["a", "b"], ["a"]],
    [
      ["a", "b"],
      ["a", "a"],
    ],
    [["a"], []],
  ])("не даёт баллов за неверный набор", (correct, selected) =>
    expect(scoreQuestion(correct, selected, 5)).toBe(0),
  );
});
describe("Файлы", () => {
  it("отклоняет скрипт с расширением PDF", () =>
    expect(validSignature(strToU8("<script>alert(1)</script>"), ".pdf")).toBe(
      false,
    ));
  it("распознаёт заголовок PDF", () =>
    expect(validSignature(strToU8("%PDF-1.7"), ".pdf")).toBe(true));
  it("не принимает обычный ZIP за DOCX", () =>
    expect(
      validSignature(zipSync({ "hello.txt": strToU8("hello") }), ".docx"),
    ).toBe(false));
  it("проверяет структуру Office", () =>
    expect(
      validSignature(
        zipSync({
          "[Content_Types].xml": strToU8("x"),
          "word/document.xml": strToU8("x"),
        }),
        ".docx",
      ),
    ).toBe(true));
  it("не принимает макросы", () =>
    expect(
      validSignature(
        zipSync({
          "[Content_Types].xml": strToU8("x"),
          "word/document.xml": strToU8("x"),
          "word/vbaProject.bin": strToU8("x"),
        }),
        ".docx",
      ),
    ).toBe(false));
});
describe("Meet adapter", () => {
  const p = new ManualMeetLink();
  it("принимает Google Meet", async () =>
    expect(
      (await p.createSession("https://meet.google.com/abc-defg-hij")).provider,
    ).toBe("manual"));
  it.each([
    "https://meet.google.com.evil.test/",
    "http://meet.google.com/",
    "https://user:password@meet.google.com/",
  ])("отклоняет %s", async (url) =>
    expect(p.createSession(url)).rejects.toThrow(),
  );
});
