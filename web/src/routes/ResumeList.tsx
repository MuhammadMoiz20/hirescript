import { useEffect, useState } from "react";
import { api, ResumeGroup, TailorResponse } from "../api";
import TailorModal from "../components/TailorModal";
import NewResumeMenu from "../components/NewResumeMenu";

export default function ResumeList({ onOpen }: { onOpen: (id: number) => void }) {
  const [groups, setGroups] = useState<ResumeGroup[]>([]);
  const [tailorTarget, setTailorTarget] = useState<{ id: number; name: string } | null>(null);

  async function refresh() {
    setGroups(await api.listGroupedResumes());
  }
  useEffect(() => { refresh(); }, []);

  async function onMenuCreated(_r: any) {
    refresh();
  }

  function onTailorCreated(_resp: TailorResponse) {
    setTailorTarget(null);
    refresh();
  }

  return (
    <div>
      <h1>Resumes</h1>
      <NewResumeMenu onCreated={onMenuCreated} />
      <ul>
        {groups.map(group => (
          <li key={group.master.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => onOpen(group.master.id)}>{group.master.name}</button>
              <button onClick={() => setTailorTarget({ id: group.master.id, name: group.master.name })}>
                Tailor to JD
              </button>
            </div>
            {group.variants.length > 0 && (
              <ul style={{ marginLeft: 24, marginTop: 6 }}>
                {group.variants.map(v => (
                  <li key={v.id}>
                    <button onClick={() => onOpen(v.id)}>{v.name}</button>
                    {v.jd_company && <span style={{ marginLeft: 8, color: "#666", fontSize: 13 }}>
                      {v.jd_title} @ {v.jd_company}
                    </span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {tailorTarget && (
        <TailorModal
          masterId={tailorTarget.id}
          masterName={tailorTarget.name}
          open={true}
          onClose={() => setTailorTarget(null)}
          onCreated={onTailorCreated}
        />
      )}
    </div>
  );
}
