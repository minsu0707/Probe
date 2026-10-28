import { useEffect, useState } from 'react';
import { api, type Doc, type Job, type KnowledgeFile } from '../../core/api.ts';
import { attempt, toast, useStore } from '../../core/store.ts';
import { settingsHref } from '../../app/router.ts';
import { Empty, Icon, OptionRow } from '../../ui/index.ts';
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
  const service = useStore((s) => s.services.find((x) => x.id === serviceId));
  /** Also walk through the live service. On by default when the service has an address. */
  const [explore, setExplore] = useState(true);
  /** After learning, Claude writes the test cases, grouped by feature. */
  const [writeTests, setWriteTests] = useState(true);
  const canExplore = Boolean(service?.baseUrl);
  const exploring = explore && canExplore;
  const job = liveJob ?? lastJob;
  const claude = useStore((s) => s.claude);
  /** Known to be unusable: not installed or signed out. While still loading (null) the button stays enabled. */
  const claudeReady = !claude || (claude.installed && Boolean(claude.auth?.loggedIn));

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
          <p className="muted">{serviceName}의 기획서, 매뉴얼, 화면 설계서를 읽고 테스트에 쓸 지식 문서로 정리합니다.</p>
        </div>
        {learning ? (
          <button className="btn btn-stop" onClick={() => void attempt(() => api.cancelLearn(serviceId))}>
            학습 중단
          </button>
        ) : (
          <button className="btn btn-primary" disabled={(!docs?.length && !exploring) || !claudeReady} onClick={() => void attempt(() => api.learn(serviceId, { explore: exploring, writeTests }))}>
            <Icon name="learn" size={16} />
            {learnLabel}
          </button>
        )}
      </div>

      <section className="panel option-list">
        <OptionRow
          title="서비스를 직접 둘러보며 학습"
          desc={canExplore ? '환경 변수의 계정(최대 8개)으로 로그인해 메뉴와 화면을 열어 보고, 계정별로 보이는 메뉴의 차이도 정리합니다. 읽기만 하고 저장·수정·삭제는 하지 않습니다.' : '서비스 주소를 먼저 입력하면 켤 수 있습니다.'}
          checked={exploring}
          disabled={!canExplore || learning}
          onChange={setExplore}
        />
        <OptionRow title="학습이 끝나면 테스트 케이스도 만들기" desc="기능별 테스트를 쓰고 우선순위(P0~P2)를 붙입니다. 결과는 테스트 케이스 탭에서 골라 실행할 수 있습니다." checked={writeTests} disabled={learning} onChange={setWriteTests} />
      </section>

      {!claudeReady && (
        <div className="callout">
          <strong>{claude?.installed ? 'Claude에 로그인해야 학습할 수 있습니다.' : 'Claude Code가 설치되어 있지 않습니다.'}</strong>
          <a className="btn btn-primary btn-sm" href={settingsHref('agent')}>
            설정에서 {claude?.installed ? '로그인' : '확인'}하기
          </a>
        </div>
      )}

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
