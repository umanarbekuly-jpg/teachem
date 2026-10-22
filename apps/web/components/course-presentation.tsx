"use client";
import Link from "next/link";
const icons: Record<string, string> = {
  Математика: "∑",
  Физика: "↗",
  "Английский язык": "Aa",
  Информатика: "</>",
  Химия: "H₂O",
};
export function CourseCover({
  subject,
  coverUrl,
}: {
  subject: string;
  coverUrl?: string | null;
}) {
  return (
    <div className={`course-art art-${subject.length % 4}`}>
      {coverUrl ? (
        <img
          className="course-cover-image"
          src={coverUrl}
          alt={`Обложка курса: ${subject}`}
        />
      ) : (
        <>
          <span className="art-symbol">{icons[subject] ?? "✳"}</span>
          <div className="art-orbit" />
        </>
      )}
      <span className="art-tag">{subject}</span>
    </div>
  );
}
export function CourseTags({
  tags,
  filterQuery = "",
}: {
  tags: string[];
  filterQuery?: string;
}) {
  return (
    <div className="course-tags">
      {tags.map((tag) => {
        const params = new URLSearchParams(filterQuery);
        params.set("tag", tag);
        params.delete("page");
        return (
          <Link
            className="course-tag"
            key={tag}
            href={`/catalog?${params.toString()}`}
          >
            #{tag}
          </Link>
        );
      })}
    </div>
  );
}
