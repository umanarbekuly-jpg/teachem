import type {
  OpenAPIObject,
  SchemaObject,
  ReferenceObject,
} from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
type S = SchemaObject | ReferenceObject;
const str: SchemaObject = { type: "string" },
  num: SchemaObject = { type: "integer" },
  bool: SchemaObject = { type: "boolean" };
const nullable = (s: SchemaObject): SchemaObject => ({ ...s, nullable: true });
const ref = (name: string): ReferenceObject => ({
  $ref: `#/components/schemas/${name}`,
});
const array = (items: S): SchemaObject => ({ type: "array", items });
const object = (properties: Record<string, S>): SchemaObject => ({
  type: "object",
  properties,
  required: Object.keys(properties),
});
const page = (name: string) =>
  object({ items: array(ref(name)), total: num, page: num, pageSize: num });
// Response contracts are explicit: database models never define what secrets an API may expose.
export function addResponseContracts(doc: OpenAPIObject) {
  const schemas = doc.components!.schemas!;
  Object.assign(schemas, {
    PublicUser: object({ id: str, name: str }),
    CourseView: object({
      id: str,
      tutorId: str,
      title: str,
      description: str,
      subject: str,
      level: str,
      monthlyPriceMinor: num,
      currency: str,
      status: { type: "string", enum: ["draft", "published", "archived"] },
      tutor: ref("PublicUser"),
    }),
    ProfileView: object({
      id: str,
      userId: str,
      bio: str,
      education: str,
      experienceYears: num,
      subjects: array(str),
      languages: array(str),
      photoAssetId: nullable(str),
      user: ref("PublicUser"),
    }),
    EnrollmentView: object({
      id: str,
      studentId: str,
      courseId: str,
      accessExpiresAt: nullable(str),
      accessStatus: { type: "string", enum: ["inactive", "active", "expired"] },
      course: object({
        id: str,
        title: str,
        subject: str,
        monthlyPriceMinor: num,
        status: str,
      }),
      student: ref("PublicUser"),
    }),
    PaymentView: object({
      id: str,
      enrollmentId: str,
      amountMinor: num,
      currency: str,
      commissionBps: num,
      status: {
        type: "string",
        enum: ["pending", "awaiting_review", "approved", "rejected"],
      },
      receiptAssetId: nullable(str),
      reviewReason: nullable(str),
      createdAt: str,
    }),
    PayoutView: object({
      id: str,
      tutorId: str,
      paymentId: str,
      grossMinor: num,
      commissionMinor: num,
      netMinor: num,
      currency: str,
      status: { type: "string", enum: ["pending", "paid"] },
      paidAt: nullable(str),
      reference: nullable(str),
    }),
    MaterialView: object({
      id: str,
      courseId: str,
      title: str,
      kind: { type: "string", enum: ["file", "link"] },
      fileAssetId: nullable(str),
      url: nullable(str),
      position: num,
    }),
    SessionView: object({
      id: str,
      courseId: str,
      topic: str,
      startsAt: str,
      durationMinutes: num,
      status: { type: "string", enum: ["scheduled", "cancelled"] },
      course: object({ title: str }),
    }),
    OptionView: object({ id: str, text: str, position: num }),
    QuestionView: object({
      id: str,
      text: str,
      type: { type: "string", enum: ["single", "multiple"] },
      points: num,
      options: array(ref("OptionView")),
    }),
    TestView: object({
      id: str,
      courseId: str,
      title: str,
      status: str,
      questions: array(ref("QuestionView")),
    }),
    TestSummary: object({ id: str, courseId: str, title: str, status: str }),
    AttemptView: object({
      id: str,
      testId: str,
      studentId: str,
      status: { type: "string", enum: ["in_progress", "submitted"] },
      score: nullable(num),
      maxScore: num,
      submittedAt: nullable(str),
    }),
    FinanceView: object({
      accruedMinor: num,
      pendingMinor: num,
      paidMinor: num,
      currency: str,
    }),
    SettingsView: object({ commissionBps: num, paymentDetails: str }),
    AdminUserView: object({
      id: str,
      name: str,
      email: str,
      role: str,
      blockedAt: nullable(str),
      createdAt: str,
    }),
    AuditView: object({
      id: str,
      actorId: str,
      action: str,
      entityType: str,
      entityId: nullable(str),
      createdAt: str,
      requestId: str,
    }),
    UploadView: object({
      id: str,
      url: str,
      fields: { type: "object", additionalProperties: str },
    }),
    InstructionsView: object({
      reference: str,
      amountMinor: num,
      currency: str,
      details: str,
    }),
    UrlView: object({ url: str }),
    OkView: object({ ok: bool }),
    CsrfView: object({ token: str }),
  });
  (schemas.OptionView as SchemaObject).properties!.isCorrect = {
    type: "boolean",
    description: "Только в ответе владельцу теста",
  };
  (schemas.ProfileView as SchemaObject).properties!.photoUrl = nullable(str);
  (schemas.PaymentView as SchemaObject).properties!.enrollment = object({
    course: object({ id: str, title: str }),
    student: ref("PublicUser"),
  });
  (schemas.PayoutView as SchemaObject).properties!.tutor = ref("PublicUser");
  (schemas.AttemptView as SchemaObject).properties!.test = object({
    title: str,
    courseId: str,
  });
  (schemas.AttemptView as SchemaObject).properties!.student = object({
    name: str,
  });
  schemas.EnrollmentCreated = object({
    id: str,
    studentId: str,
    courseId: str,
    accessStartsAt: nullable(str),
    accessExpiresAt: nullable(str),
  });
  const mappings: Record<string, string> = {
    Courses_list: "CourseView[]",
    Courses_mine: "CourseView[]",
    Courses_get: "CourseView",
    Courses_create: "CourseView",
    Courses_update: "CourseView",
    Courses_publish: "CourseView",
    Courses_archive: "CourseView",
    Courses_remove: "CourseView",
    Tutors_list: "ProfileView[]",
    Tutors_get: "ProfileView",
    Tutors_mine: "ProfileView",
    Tutors_update: "ProfileView",
    Enrollments_mine: "EnrollmentView[]",
    Enrollments_students: "EnrollmentView[]",
    Enrollments_allStudents: "EnrollmentView[]",
    Enrollments_enroll: "EnrollmentCreated",
    Payments_mine: "PaymentView[]",
    Payments_create: "PaymentView",
    Payments_get: "PaymentView",
    Payments_submit: "PaymentView",
    Payments_instructions: "InstructionsView",
    Payouts_finance: "FinanceView",
    Payouts_list: "PayoutView[]",
    Materials_list: "MaterialView[]",
    Materials_create: "MaterialView",
    Materials_update: "MaterialView",
    Materials_remove: "MaterialView",
    Sessions_mine: "SessionView[]",
    Sessions_list: "SessionView[]",
    Sessions_create: "SessionView",
    Sessions_update: "SessionView",
    Sessions_cancel: "SessionView",
    Sessions_join: "UrlView",
    Tests_list: "TestSummary[]",
    Tests_get: "TestView",
    Tests_create: "TestView",
    Tests_update: "TestView",
    Tests_copy: "TestView",
    Tests_publish: "TestSummary",
    Tests_remove: "TestSummary",
    Tests_start: "AttemptView",
    Tests_attempt: "AttemptView",
    Tests_submit: "AttemptView",
    Tests_mine: "AttemptView[]",
    Tests_attempts: "AttemptView[]",
    Tests_save: "OkView",
    Admin_users: "AdminUserView[]",
    Admin_block: "AdminUserView",
    Admin_unblock: "AdminUserView",
    Admin_listPayments: "PaymentView[]",
    Admin_approve: "PaymentView",
    Admin_reject: "PaymentView",
    Admin_listPayouts: "PayoutView[]",
    Admin_paid: "PayoutView",
    Admin_getSettings: "SettingsView",
    Admin_updateSettings: "SettingsView",
    Admin_logs: "AuditView[]",
    Files_upload: "UploadView",
    Files_download: "UrlView",
    Auth_csrf: "CsrfView",
    Auth_logout: "OkView",
    Users_me: "UserView",
    Users_update: "UserView",
    Enrollments_learning: "CourseView",
  };
  for (const path of Object.values(doc.paths))
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      const op = path?.[method];
      if (!op) continue;
      const name = mappings[op.operationId ?? ""];
      if (!name) continue;
      const schema = name.endsWith("[]") ? page(name.slice(0, -2)) : ref(name);
      const status = method === "post" ? "201" : "200";
      op.responses = {
        [status]: {
          description: "Успешный ответ",
          content: { "application/json": { schema } },
        },
        ...Object.fromEntries(
          [400, 401, 403, 404, 409, 429].map((code) => [
            String(code),
            { description: "Ошибка запроса" },
          ]),
        ),
      };
    }
  return doc;
}
