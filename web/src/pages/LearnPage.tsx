import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Doc, type Job, type KnowledgeFile } from '../api.ts';
import { ago, bytes, duration } from '../format.ts';
import { attempt, toast, useStore } from '../store.ts';
import { Empty, FileDrop, Icon, Markdown, Pill, useNow } from '../ui.tsx';

const FILE_LABEL: Record<string, string> = {
  'overview.md': '개요',
  'screens.md': '화면',
  'flows.md': '업무 흐름',
  'rules.md': '규칙',
  'test-points.md': '테스트 포인트',
  'open-questions.md': '미확인 사항',
};

export function LearnPage() {
  const service = useStore((s) => s.services.find((x) => x.id === s.currentId));
  if (!service) return <Empty title="서비스를 먼저 등록하세요">도메인 문서는 서비스별로 보관됩니다.</Empty>;
  return <LearnBody key={service.id} serviceId={service.id} serviceName={service.name} learning={service.learning} />;
}

function LearnBody({ serviceId, serviceName, learning }: { serviceId: string; serviceName: string; learning: boolean }) {
  const version = useStore((s) => s.serviceVersion[serviceId] ?? 0);
  const liveJob = useStore((s) => s.jobs[serviceId]);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [supported, setSupported] = useState<string[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeFile[]>([]);
  const [lastJob, setLastJob] = useState<Job | null>(null);
  const job = liveJob ?? lastJob;

  useEffect(() => {
    let alive = true;
    Promise.all([api.docs(serviceId), api.knowledge(serviceId), api.jobs(serviceId)]).then(
      ([d, k, j]) => {
        if (!alive) return;
        setDocs(d.docs);
        setSupported(d.supported);
        setKnowledge(k);
        setLastJob(j[0] ?? null);
      },
      (e: Error) => toast(e.message, 'error'),
    );
    return () => {
      alive = false;
    };
  }, [serviceId, version, liveJob?.status]);

  const unlearned = docs?.filter((d) => !d.learnedAt).length ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>도메인 학습</h1>
          <p className="muted">{serviceName}의 기획서, 매뉴얼, 화면 설계서를 읽고 테스트에 쓸 지식 문서로 정리합니다.</p>
        </div>
        {learning ? (
          <button className="btn btn-danger" onClick={() => void attempt(() => api.cancelLearn(serviceId))}>
            <Icon name="stop" size={14} />
            학습 중단
          </button>
        ) : (
          <button className="btn btn-primary" disabled={!docs?.length} onClick={() => void attempt(() => api.learn(serviceId))}>
            <Icon name="learn" size={16} />
            {knowledge.length ? (unlearned ? `새 문서 ${unlearned}개 포함해 다시 학습` : '다시 학습') : '학습 시작'}
          </button>
        )}
      </div>

      <div className="split split-learn">
        <SourcesPanel serviceId={serviceId} docs={docs} supported={supported} />
        <div className="stack">
          {job && (job.status === 'running' || job.endedAt) && <JobCard job={job} />}
          <KnowledgePanel serviceId={serviceId} files={knowledge} onSaved={(f) => setKnowledge((k) => k.map((x) => (x.name === f.name ? f : x)))} />
        </div>
      </div>
    </>
  );
}

function SourcesPanel({ serviceId, docs, supported }: { serviceId: string; docs: Doc[] | null; supported: string[] }) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const now = useNow(30_000);

  const upload = async (files: File[]) => {
    setBusy(true);
    let n = 0;
    for (const f of files) if (await attempt(() => api.uploadDoc(serviceId, f))) n++;
    setBusy(false);
    if (n) toast(`${n}개 파일을 올렸습니다`);
  };

  const addLink = async (e: FormEvent) => {
    e.preventDefault();
    if (await attempt(() => api.addDrive(serviceId, link), 'Drive 링크를 추가했습니다')) setLink('');
  };

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
        <ul className="docs">
          {docs.map((d) => (
            <li key={d.id}>
              <Icon name={d.kind === 'drive' ? 'drive' : 'file'} size={18} />
              <div className="doc-main">
                <span className="ellipsis" title={d.kind === 'drive' ? d.ref : d.name}>
                  {d.name}
                </span>
                <span className="muted small">{d.kind === 'drive' ? 'Google Drive' : bytes(d.size)}</span>
              </div>
              {d.learnedAt ? <Pill tone="pass">학습됨 · {ago(d.learnedAt, now)}</Pill> : <Pill tone="warn">새 자료</Pill>}
              <button className="btn btn-quiet btn-icon btn-sm" aria-label={`${d.name} 삭제`} onClick={() => void attempt(() => api.deleteDoc(serviceId, d.id))}>
                <Icon name="trash" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Drive 링크는 이 컴퓨터의 Claude에 연결된 Google Drive 권한으로 읽습니다. 읽을 수 없으면 학습 로그에 이유가 표시됩니다. 구버전 .doc/.xls/.ppt는 읽을 수 없으니 .docx/.xlsx/.pptx로 저장해 올려주세요.
      </p>
    </section>
  );
}

function JobCard({ job }: { job: Job }) {
  const now = useNow(1000);
  const box = useRef<HTMLOListElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [job.log.length]);
  const running = job.status === 'running';
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>학습 진행</h2>
        {running ? (
          <Pill tone="run" dot>
            {duration(now - job.startedAt)}
          </Pill>
        ) : job.status === 'done' ? (
          <Pill tone="pass">완료 · {duration((job.endedAt ?? now) - job.startedAt)}</Pill>
        ) : (
          <Pill tone={job.status === 'cancelled' ? 'neutral' : 'fail'}>{job.status === 'cancelled' ? '중단됨' : '실패'}</Pill>
        )}
      </div>
      {job.log.length > 0 && (
        <ol className="joblog" ref={box}>
          {job.log.map((l, i) => (
            <li key={i} className={i === job.log.length - 1 && running ? 'joblog-now' : undefined}>
              {l}
            </li>
          ))}
        </ol>
      )}
      {!running && job.summary && <div className="job-summary">{job.status === 'done' ? <Markdown source={job.summary} /> : <p className="error-text">{job.summary}</p>}</div>}
    </section>
  );
}

function KnowledgePanel({ serviceId, files, onSaved }: { serviceId: string; files: KnowledgeFile[]; onSaved: (f: KnowledgeFile) => void }) {
  const [active, setActive] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const file = files.find((f) => f.name === active) ?? files[0];

  useEffect(() => setEditing(false), [file?.name]);

  if (!file)
    return (
      <section className="panel">
        <h2>지식 문서</h2>
        <Empty title="아직 학습한 내용이 없습니다">자료를 올리고 <strong>학습 시작</strong>을 누르면 개요, 화면, 업무 흐름, 규칙, 테스트 포인트가 문서로 정리됩니다. Claude가 테스트 코드를 쓸 때 이 문서를 먼저 읽습니다.</Empty>
      </section>
    );

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>지식 문서</h2>
        {editing ? (
          <div className="actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={async () => {
                if (await attempt(() => api.saveKnowledge(serviceId, file.name, draft), '저장했습니다')) {
                  onSaved({ ...file, content: draft, updatedAt: Date.now() });
                  setEditing(false);
                }
              }}
            >
              저장
            </button>
            <button className="btn btn-sm" onClick={() => setEditing(false)}>
              취소
            </button>
          </div>
        ) : (
          <button className="btn btn-quiet btn-sm" onClick={() => (setDraft(file.content), setEditing(true))}>
            <Icon name="edit" size={14} />
            직접 수정
          </button>
        )}
      </div>
      <div className="tabs" role="tablist">
        {files.map((f) => (
          <button key={f.name} role="tab" aria-selected={f.name === file.name} className={`tab${f.name === file.name ? ' tab-on' : ''}`} onClick={() => setActive(f.name)}>
            {FILE_LABEL[f.name] ?? f.name}
          </button>
        ))}
      </div>
      {editing ? <textarea className="editor" aria-label={`${file.name} 편집`} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} /> : <Markdown source={file.content} />}
      <p className="muted small">
        대괄호는 근거가 된 자료이고, (추정) 표시는 자료에 없는 내용을 Claude가 짐작한 부분입니다. 틀린 부분은 직접 고치세요. 다시 학습할 때 Claude는 기존 문서를 먼저 읽고, 자료와 충돌하지 않는 수정은 남기도록 지시받습니다.
      </p>
    </section>
  );
}
