"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="container section">
      <h1>Не удалось открыть страницу</h1>
      <p className="subheading" style={{ marginTop: 16 }}>
        Попробуйте загрузить её ещё раз.
      </p>
      <button className="btn btn-primary" onClick={reset}>
        Повторить
      </button>
    </main>
  );
}
