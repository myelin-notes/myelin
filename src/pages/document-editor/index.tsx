import { useParams } from "react-router-dom";

export function DocumentView() {
  const params = useParams();
  const path = params["*"]?.split("/").filter(Boolean) ?? [];

  return <div className="p-8">{path.join("/")}</div>;
}
