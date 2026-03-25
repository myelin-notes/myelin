import { useParams } from "react-router-dom";

export function DocumentView() {
  const { id } = useParams<{ id: string }>();

  return <div className="p-8">Document: {id}</div>;
}
