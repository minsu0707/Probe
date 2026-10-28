import { useEffect, useState } from 'react';
import { api, type RunSummary, type ServiceOverview } from '../../core/api.ts';
import { runButtonProps } from '../../core/runGuard.ts';
import { RUN_STATUS_LABEL, startTime } from '../../core/format.ts';
import { attempt, loadRun, loadRuns, useStore } from '../../core/store.ts';
import { ConfirmModal, ContextMenu, Empty, Icon } from '../../ui/index.ts';
import { RunView } from './RunView.tsx';

/** 실시간 모니터링: follows the live run, or shows any earlier run picked from the list. */
export function MonitorPage() {
  const service = useStore((s) => s.services.find((x) => x.id === s.currentId));
  const runs = useStore((s) => s.runs);
  if (!service) return <Empty title="서비스를 먼저 등록하세요">서비스를 등록하면 이곳에서 테스트 진행 상황을 볼 수 있습니다.</Empty>;

  const mine = Object.values(runs)
    .filter((r) => r.serviceId === service.id)
    .sort((a, b) => b.startedAt - a.startedAt);
  return <MonitorBody key={service.id} service={service} runs={mine} />;
}

function MonitorBody({ service, runs }: { service: ServiceOverview; runs: RunSummary[] }) {
  const { id: serviceId, name: serviceName } = service;
  const [picked, setPicked] = useState<string | null>(null);
  /** The user chose an older run on purpose; stop auto-following new live runs. */
  const [pinned, setPinned] = useState(false);
  const [deleting, setDeleting] = useState<'one' | 'all' | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const liveId = runs.find((r) => r.status === 'running' || r.status === 'starting')?.id;
  const runId = pinned && picked ? picked : (liveId ?? picked ?? runs[0]?.id ?? null);
  const run = runs.find((r) => r.id === runId);
  const finished = runs.filter((r) => r.status !== 'running' && r.status !== 'starting');
  const running = run?.status === 'running' || run?.status === 'starting';

  useEffect(() => void loadRuns(serviceId).catch(() => undefined), [serviceId]);
  useEffect(() => {
    if (runId) void loadRun(runId).catch(() => undefined);
  }, [runId]);

  if (!run) {
    return (
      <>
        <div className="page-head">
          <div>
            <p className="muted">테스트가 실행되면 어떤 페이지와 기능을 보고 있는지 여기에 실시간으로 표시됩니다.</p>
          </div>
        </div>
        <Empty
          title="아직 실행한 테스트가 없습니다"
          action={
            <button className="btn btn-primary" {...runButtonProps(service, () => void attempt(() => api.startRun(serviceId)))}>
              <Icon name="play" size={14} />
              테스트 실행
            </button>
          }
        >
          {serviceName}에 대한 테스트 코드는 Claude가 작성합니다. Claude에게 “{serviceName} 테스트해줘”라고 요청하거나, 작성된 테스트가 있으면 위 버튼으로 바로 실행하세요.
        </Empty>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">{run.title}</p>
        </div>
        <div className="run-tools">
        <label className="run-picker">
          <span className="eyebrow">실행 기록</span>
          <select
            value={run.id}
            onChange={(e) => {
              setPicked(e.target.value);
              setPinned(true);
            }}
          >
            {runs.slice(0, 30).map((r) => (
              <option key={r.id} value={r.id}>
                {startTime(r.startedAt)} · {RUN_STATUS_LABEL[r.status]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn"
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <Icon name="trash" size={14} />
          기록 삭제
        </button>
        </div>
      </div>
      <RunView
        run={run}
        serviceName={serviceName}
        runs={runs}
        onPick={(id) => {
          setPicked(id);
          setPinned(true);
        }}
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: '지금 보는 기록 삭제', disabled: running, hint: '실행 중인 기록은 먼저 중단하세요', onSelect: () => setDeleting('one') },
            { label: `끝난 기록 모두 삭제 (${finished.length}건)`, danger: true, disabled: finished.length === 0, onSelect: () => setDeleting('all') },
          ]}
        />
      )}
      {deleting && (
        <ConfirmModal
          title={deleting === 'one' ? '실행 기록 삭제' : '끝난 실행 기록 모두 삭제'}
          onConfirm={async () => {
            const ids = deleting === 'one' ? [run.id] : finished.map((r) => r.id);
            const done = await attempt(() => api.deleteRuns(ids));
            if (done) {
              setDeleting(null);
              setPicked(null);
              setPinned(false);
            }
          }}
          onClose={() => setDeleting(null)}
        >
          {deleting === 'one' ? `${startTime(run.startedAt)} 실행의 기록과 로그를 삭제합니다.` : `진행 중인 실행을 뺀 ${finished.length}건의 기록과 로그를 삭제합니다.`} 이미 등록된 결함은 그대로 남습니다. 되돌릴 수 없습니다.
        </ConfirmModal>
      )}
    </>
  );
}
