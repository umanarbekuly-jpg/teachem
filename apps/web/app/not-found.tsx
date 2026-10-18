import Link from "next/link";
export default function NotFound() {
  return (
    <main className="container section">
      <span className="eyebrow">404</span>
      <h1>Страница не найдена</h1>
      <p className="subheading" style={{ marginTop: 16 }}>
        Возможно, ссылка устарела.
      </p>
      <Link className="btn btn-primary" href="/">
        На главную
      </Link>
    </main>
  );
}
