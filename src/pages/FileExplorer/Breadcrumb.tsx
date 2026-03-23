import { Link } from "react-router-dom";

interface BreadcrumbProps {
  path: string[];
}

export function Breadcrumb({ path }: BreadcrumbProps) {
  return (
    <div className="flex flex-row">
      {path.map((p, i) => (
        <span key={i}>
          <Link
            to={`/file/${path.slice(0, i + 1).join("/")}`}
            className="text-lg hover:underline"
          >
            {p}
          </Link>
          {i !== path.length - 1 && (
            <span className="mx-1"> &gt; </span>
          )}
        </span>
      ))}
    </div>
  );
}
