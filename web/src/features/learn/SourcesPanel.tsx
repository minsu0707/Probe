import { useState, type FormEvent } from 'react';
import { api, type Doc } from '../../core/api.ts';
import { ago, bytes } from '../../core/format.ts';
import { attempt, toast } from '../../core/store.ts';
import { ConfirmModal, FileDrop, Icon, Pill, useNow } from '../../ui/index.ts';

/** 자료: uploaded files and Drive links, and which of them Claude has already learned. */
export function SourcesPanel({ serviceId, docs, supported, picked, onPick, unlearned, locked }: { serviceId: string; docs: Doc[] | null; supported: string[]; picked: Set<string>; onPick: (s: Set<string>) => void; unlearned: number; locked: boolean }) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [deleting, setDeleting] = useState<Doc | null>(null);
  const now = useNow(30_000);

  /** Uploads one at a time so each file's error (wrong type, too big) is reported on its own. */
  const upload = async (files: File[]) => {
    setBusy(true);
    let uploaded = 0;
    for (const file of files) if (await attempt(() => api.uploadDoc(serviceId, file))) uploaded++;
    setBusy(false);
    if (uploaded) toast(`${uploaded}개 파일을 올렸습니다`);
  };

  const addLink = async (e: FormEvent) => {
    e.preventDefault();
    if (await attempt(() => api.addDrive(serviceId, link), 'Drive 링크를 추가했습니다')) setLink('');
  };

  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    onPick(next);
  };
  const allPicked = Boolean(docs?.length) && docs!.every((d) => picked.has(d.id));
  const somePicked = Boolean(docs?.some((d) => picked.has(d.id)));

  return (
    <section className="panel">
      <h2>자료</h2>
      <FileDrop multiple busy={busy} accept={supported.join(',')} label="문서를 끌어다 놓거나 선택" hint="PDF, Word, Excel, PowerPoint, 이미지, Markdown, 텍스트 · 파일당 50MB까지" onFiles={upload} />

      <form className="inline-form" onSubmit={addLink}>
        <label htmlFor="drive-link" className="sr">
          Google Drive 링크
        </label>
        <input id="drive-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Google Drive 파일 또는 폴더 링크" inputMode="url" />
        <button className="btn" disabled={!link.trim()}>
          <Icon name="drive" size={16} />
          추가
        </button>
      </form>

      {docs === null ? null : docs.length === 0 ? (
        <p className="muted small">아직 올린 자료가 없습니다.</p>
      ) : (
        <>
          {unlearned > 0 && (
            <div className="doc-alert" role="status">
              <span>
                <b>학습 안 된 자료 {unlearned}개</b>
                <span className="muted"> · 지식 문서에 아직 반영되지 않았습니다</span>
              </span>
              <button className="btn btn-sm" disabled={locked} onClick={() => onPick(new Set(docs.filter((d) => !d.learnedAt).map((d) => d.id)))}>
                이것만 선택
              </button>
            </div>
          )}
          <label className="doc-all">
            <input type="checkbox" disabled={locked} checked={allPicked} ref={(el) => void (el && (el.indeterminate = somePicked && !allPicked))} onChange={(e) => onPick(e.target.checked ? new Set(docs.map((d) => d.id)) : new Set())} />
            <span>전체 선택</span>
            <span className="muted small">
              {docs.filter((d) => picked.has(d.id)).length}/{docs.length}개 선택됨 · 선택한 자료만 읽습니다
            </span>
          </label>
        <ul className="docs">
          {docs.map((d) => (
            <li key={d.id} className={d.learnedAt ? undefined : 'doc-new'}>
              <input type="checkbox" disabled={locked} checked={picked.has(d.id)} onChange={(e) => toggle(d.id, e.target.checked)} aria-label={`${d.name} 학습에 포함`} />
              <Icon name={d.kind === 'drive' ? 'drive' : 'file'} size={18} />
              <div className="doc-main">
                <span className="ellipsis" title={d.kind === 'drive' ? d.ref : d.name}>
                  {d.name}
                </span>
                <span className="muted small">{d.kind === 'drive' ? 'Google Drive' : bytes(d.size)}</span>
              </div>
              {d.learnedAt ? <Pill tone="pass">학습됨 · {ago(d.learnedAt, now)}</Pill> : <Pill tone="fail" dot>학습 안 됨</Pill>}
              <button className="btn btn-quiet btn-icon btn-sm" aria-label={`${d.name} 삭제`} onClick={() => setDeleting(d)}>
                <Icon name="trash" size={15} />
              </button>
            </li>
          ))}
        </ul>
        </>
      )}

      {deleting && (
        <ConfirmModal title="자료 삭제" onConfirm={() => attempt(() => api.deleteDoc(serviceId, deleting.id))} onClose={() => setDeleting(null)}>
          <b>{deleting.name}</b>
          {deleting.kind === 'drive' ? ' 링크를 목록에서 지웁니다. Drive의 원본은 그대로입니다.' : ' 파일을 삭제합니다. 이미 학습한 내용은 지식 문서에 남지만, 이 파일은 다시 올려야 합니다.'}
        </ConfirmModal>
      )}

      <p className="muted small">
        Drive 링크는 이 컴퓨터의 Claude에 연결된 Google Drive 권한으로 읽습니다. 읽을 수 없으면 학습 로그에 이유가 표시됩니다. 구버전 .doc/.xls/.ppt는 읽을 수 없으니 .docx/.xlsx/.pptx로 저장해 올려주세요.
      </p>
    </section>
  );
}
