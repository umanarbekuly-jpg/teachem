export function accountPath(user: {
  role: string;
  mustChangePassword?: boolean;
}) {
  return user.mustChangePassword
    ? "/change-password"
    : user.role === "SUPERADMIN"
      ? "/admin"
      : `/${user.role}`;
}
