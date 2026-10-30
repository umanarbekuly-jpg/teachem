// Existing PostgreSQL column whitelist. No schema changes.
package core

var columns = map[string]map[string]string{
	"User":                 {"id": "String", "email": "String", "passwordHash": "String", "name": "String", "surname": "String", "phone": "String", "bio": "String", "photoAssetId": "String", "emailVerifiedAt": "DateTime", "mustChangePassword": "Boolean", "authVersion": "Int", "role": "Role", "blockedAt": "DateTime", "deletedAt": "DateTime", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"AuthSession":          {"id": "String", "userId": "String", "refreshTokenHash": "String", "authVersion": "Int", "expiresAt": "DateTime", "revokedAt": "DateTime", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"TutorProfile":         {"id": "String", "userId": "String", "photoAssetId": "String", "bio": "String", "experienceYears": "Int", "education": "String", "subjects": "String[]", "languages": "String[]", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"Course":               {"id": "String", "tutorId": "String", "title": "String", "description": "String", "subject": "String", "level": "String", "durationDays": "Int", "tags": "String[]", "coverAssetId": "String", "monthlyPriceMinor": "Int", "currency": "String", "status": "CourseStatus", "deletedAt": "DateTime", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"FileAsset":            {"id": "String", "ownerId": "String", "purpose": "FilePurpose", "objectKey": "String", "originalName": "String", "mimeType": "String", "sizeBytes": "Int", "status": "FileStatus", "expiresAt": "DateTime", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"Material":             {"id": "String", "courseId": "String", "title": "String", "kind": "MaterialKind", "fileAssetId": "String", "url": "String", "position": "Int", "deletedAt": "DateTime", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"Enrollment":           {"id": "String", "studentId": "String", "courseId": "String", "accessStartsAt": "DateTime", "accessExpiresAt": "DateTime", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"Payment":              {"id": "String", "enrollmentId": "String", "amountMinor": "Int", "durationDays": "Int", "currency": "String", "commissionBps": "Int", "provider": "String", "status": "PaymentStatus", "receiptAssetId": "String", "submittedAt": "DateTime", "reviewedAt": "DateTime", "reviewerId": "String", "reviewReason": "String", "idempotencyKey": "String", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"PaymentStatusHistory": {"id": "String", "paymentId": "String", "fromStatus": "PaymentStatus", "toStatus": "PaymentStatus", "actorId": "String", "reason": "String", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"Payout":               {"id": "String", "paymentId": "String", "tutorId": "String", "grossMinor": "Int", "commissionMinor": "Int", "netMinor": "Int", "currency": "String", "status": "PayoutStatus", "paidAt": "DateTime", "paidById": "String", "reference": "String", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"Test":                 {"id": "String", "courseId": "String", "title": "String", "status": "TestStatus", "deletedAt": "DateTime", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"Question":             {"id": "String", "testId": "String", "text": "String", "type": "QuestionType", "points": "Int", "position": "Int", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"AnswerOption":         {"id": "String", "questionId": "String", "text": "String", "isCorrect": "Boolean", "position": "Int", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"TestAttempt":          {"id": "String", "testId": "String", "studentId": "String", "status": "AttemptStatus", "startedAt": "DateTime", "submittedAt": "DateTime", "score": "Int", "maxScore": "Int", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"AttemptAnswer":        {"id": "String", "attemptId": "String", "questionId": "String", "awardedPoints": "Int", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"AttemptAnswerOption":  {"id": "String", "attemptAnswerId": "String", "answerOptionId": "String", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"LiveSession":          {"id": "String", "courseId": "String", "topic": "String", "startsAt": "DateTime", "durationMinutes": "Int", "provider": "String", "joinUrl": "String", "status": "SessionStatus", "deletedAt": "DateTime", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"PlatformSetting":      {"id": "String", "key": "String", "value": "Json", "updatedById": "String", "createdAt": "DateTime", "updatedAt": "DateTime"},
	"AuditLog":             {"id": "String", "actorId": "String", "action": "String", "entityType": "String", "entityId": "String", "requestId": "String", "metadata": "Json", "createdAt": "DateTime", "updatedAt": "DateTime"},
}
