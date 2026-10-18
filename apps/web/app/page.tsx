import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  Compass,
  GraduationCap,
  Sparkles,
} from "lucide-react";
import { Footer, Header } from "@/components/common";
import { Button } from "@/components/ui/button";
export default function Home() {
  return (
    <>
      <Header />
      <main>
        <section className="hero container">
          <div className="hero-copy">
            <span className="pill">
              <span />
              Знания, которые открывают возможности
            </span>
            <h1>
              Большие цели.
              <br />
              <span>Ваш темп.</span>
              <br />
              Ваш тьютор.
            </h1>
            <p>
              От первого «не понимаю» до уверенного «я могу». Найдите наставника
              и двигайтесь к своей цели шаг за шагом.
            </p>
            <div className="hero-actions">
              <Button asChild>
                <Link href="/catalog">
                  Найти свой курс
                  <ArrowRight size={18} />
                </Link>
              </Button>
              <Link href="/register?role=tutor" className="text-link">
                Я хочу преподавать ↗
              </Link>
            </div>
            <div className="hero-note">
              <Check size={16} />
              Занятия онлайн<span>·</span>Материалы в одном месте
            </div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="visual-grid" />
            <div className="floating-label">
              <Sparkles size={18} />
              Всё начинается с интереса
            </div>
            <div className="learning-card">
              <span className="small-label">ВАША ТРАЕКТОРИЯ РОСТА</span>
              <div className="stairs">
                <i />
                <i />
                <i />
                <i />
                <span>
                  <GraduationCap size={42} />
                </span>
              </div>
              <h3>
                Следующий шаг —<br />
                ближе, чем кажется.
              </h3>
              <div className="progress-line">
                <span />
              </div>
              <div className="visual-bottom">
                <span>Новые знания каждый день</span>
                <ArrowRight size={18} />
              </div>
            </div>
            <div className="float-card">
              <span className="check-circle">
                <Check size={18} />
              </span>
              <div>
                <strong>В своём ритме</strong>
                <small>С поддержкой наставника</small>
              </div>
            </div>
            <div className="visual-star">✳</div>
          </div>
        </section>
        <section className="subjects-band">
          <div className="container">
            <span>ЧТО ХОЧЕТСЯ ИЗУЧАТЬ?</span>
            {[
              "Математика",
              "Английский язык",
              "Физика",
              "Информатика",
              "Казахский язык",
            ].map((s) => (
              <Link key={s} href={`/catalog?subject=${encodeURIComponent(s)}`}>
                {s}
                <ArrowRight size={14} />
              </Link>
            ))}
          </div>
        </section>
        <section className="container section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">ПОНЯТНЫЙ ПУТЬ К ЗНАНИЯМ</span>
              <h2>
                Меньше организационных забот.
                <br />
                Больше самого обучения.
              </h2>
            </div>
            <Link className="text-link" href="/catalog">
              Открыть каталог ↗
            </Link>
          </div>
          <div className="feature-grid">
            {[
              {
                icon: Compass,
                title: "Найдите своего человека",
                text: "Выберите предмет, уровень и тьютора, чей подход вам близок.",
              },
              {
                icon: BookOpen,
                title: "Учитесь с опорой",
                text: "Материалы, задания и результаты тестов всегда под рукой.",
              },
              {
                icon: CalendarDays,
                title: "Встречайтесь онлайн",
                text: "Следите за расписанием и переходите на занятие по одной ссылке.",
              },
            ].map((f, i) => (
              <article key={f.title} className="feature">
                <span className="feature-number">0{i + 1}</span>
                <f.icon size={26} />
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="container tutor-cta">
          <div>
            <span className="eyebrow">ДЛЯ ТЕХ, КТО ДЕЛИТСЯ ЗНАНИЯМИ</span>
            <h2>
              Ваш опыт может стать
              <br />
              чьим-то новым началом.
            </h2>
            <p>
              Создавайте курсы, проводите занятия и отслеживайте успехи учеников
              в одном кабинете.
            </p>
            <Button asChild>
              <Link href="/register?role=tutor">
                Стать тьютором
                <ArrowRight size={18} />
              </Link>
            </Button>
          </div>
          <div className="cta-symbol" aria-hidden="true">
            Aa<span>↗</span>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
