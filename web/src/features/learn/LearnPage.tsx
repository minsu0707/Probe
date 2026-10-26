import { useEffect, useState } from 'react';
import { api, type Doc, type Job, type KnowledgeFile } from '../../core/api.ts';
import { attempt, toast, useStore } from '../../core/store.ts';
import { Empty, Icon } from '../../ui/index.ts';
import { JobCard } from './JobCard.tsx';
import { KnowledgePanel } from './KnowledgePanel.tsx';
import { SourcesPanel } from './SourcesPanel.tsx';

/** 도메인 학습: add documents, press the button, read and correct what Claude learned. */
export function LearnPage() {
  const service = useStore((s) => s.services.find((x) => x.id === s.currentId));
  if (!service) return <Empty title="서비스를 먼저 등록하세요">도메인 문서는 서비스별로 보관됩니다.</Empty>;
  // key remounts per service so one service's documents never flash while another loads
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

  // Refetch on server-reported changes and when a job finishes (new knowledge files appear).
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
  const learnLabel = !knowledge.length ? '학습 시작' : unlearned ? `새 문서 ${unlearned}개 포함해 다시 학습` : '다시 학습';

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
            {learnLabel}
          </button>
        )}
      </div>

      <div className="split split-learn">
        <SourcesPanel serviceId={serviceId} docs={docs} supported={supported} />
        <div className="stack">
          {job && (job.status === 'running' || job.endedAt) && <JobCard job={job} />}
          <KnowledgePanel serviceId={serviceId} files={knowledge} onSaved={(f) => setKnowledge((all) => all.map((x) => (x.name === f.name ? f : x)))} />
        </div>
      </div>
    </>
  );
}
