import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
const db = new PrismaClient();
async function seed() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (
    !email ||
    !password ||
    Buffer.byteLength(password) > 72 ||
    password.length < 12 ||
    password === "replace-with-a-strong-password"
  )
    throw new Error(
      "Set ADMIN_EMAIL and a unique ADMIN_PASSWORD (12–72 bytes)",
    );
  const existing = await db.user.findUnique({ where: { email } });
  if (existing && existing.role !== "admin") throw new Error("ADMIN_EMAIL already belongs to a non-admin user");
  await db.user.upsert({
    where: { email },
    create: {
      email,
      name: "Администратор",
      role: "admin",
      passwordHash: await hash(password, 12),
    },
    update: {},
  });
  await db.platformSetting.upsert({
    where: { key: "commissionBps" },
    create: { key: "commissionBps", value: 1000 },
    update: {},
  });
  await db.platformSetting.upsert({
    where: { key: "paymentDetails" },
    create: { key: "paymentDetails", value: "" },
    update: {},
  });
  console.log(
    "Администратор и настройки созданы. Укажите реквизиты в админ-панели.",
  );
}
seed()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
