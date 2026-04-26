import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listJobs } from "../api";

export function JobsBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const { total } = await listJobs({ status: "queued,running" });
        if (!cancelled) setCount(total);
      } catch {
        // ignore polling errors
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  if (count === 0) return null;
  return (
    <Link to="/jobs" data-testid="jobs-badge" className="badge">
      {count}
    </Link>
  );
}
