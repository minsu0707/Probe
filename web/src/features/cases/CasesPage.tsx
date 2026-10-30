import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ServiceOverview, type TestCase } from '../../core/api.ts';
import { goService } from '../../app/router.ts';
import { isTemporarySpec } from '../../../../shared/temp-spec.ts';
import { useStore, attempt } from '../../core/store.ts';
import { ConfirmModal, Empty, Icon, Loading, Pill } from '../../ui/index.ts';

/** 테스트 케이스: what Claude wrote, grouped by feature, with a choice of what to run. */
export function CasesPage() {
  const service = useStore((s) => s.services.find((x) => x.id === s.currentId));
  if (!service) return <Empty title="서비스를 먼저 등록하세요">서비스를 등록하면 Claude가 쓴 테스트 케이스를 이곳에서 볼 수 있습니다.</Empty>;
  return <CasesBody key={service.id} service={service} />;
}

function CasesBody({ service }: { service: ServiceOverview }) {
  const [cases, setCases] = useState<TestCase[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<TestCase[] | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const running = Boolean(service.activeRun);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.testCases(service.id);
      setCases(r.cases);
      setErrors(r.errors);
      // A rewritten spec can drop a case; never keep a selection that no longer exists.
      setPicked((prev) => new Set([...prev].filter((id) => r.cases.some((c) => c.id === id))));
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
      setCases((c) => c ?? []);
    } finally {
      setLoading(false);
    }
  }, [service.id]);

  // Load on open, and again when Claude finishes writing (its turn ends, claudeWorking goes false).
  useEffect(() => void load(), [load, service.claudeWorking]);

  const q = query.trim().toLowerCase();
  const matching = useMemo(() => (cases ?? []).filter((c) => !q || `${c.title} ${c.feature} ${c.file} ${c.source ?? ''} ${c.tags.join(' ')}`.toLowerCase().includes(q)), [cases, q]);
  // Files Claude made only to look at the site stay out of the real list, the counts and "전체 실행".
  const real = useMemo(() => (cases ?? []).filter((c) => !isTemporarySpec(c.file)), [cases]);
  const temporary = useMemo(() => (cases ?? []).filter((c) => isTemporarySpec(c.file)), [cases]);
  const visible = useMemo(() => matching.filter((c) => !isTemporarySpec(c.file)), [matching]);
  const visibleTemporary = useMemo(() => matching.filter((c) => isTemporarySpec(c.file)), [matching]);
  const groups = useMemo(() => {
    const by = new Map<string, TestCase[]>();
    for (const c of visible) by.set(c.feature, [...(by.get(c.feature) ?? []), c]);
    return [...by.entries()];
  }, [visible]);

  const toggleOpen = (id: string) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const setMany = (list: TestCase[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const c of list) (on ? next.add(c.id) : next.delete(c.id));
      return next;
    });
  const allVisiblePicked = visible.length > 0 && visible.every((c) => picked.has(c.id));

  const start = async (list: TestCase[] | null) => {
    // "전체 실행" with temporary files around names the real cases, so those files are not run.
    const only = list ?? (temporary.length ? real : null);
    const body = only ? { tests: only.map((c) => ({ file: c.file, line: c.line })), title: list ? `${service.name} · 선택한 ${list.length}개` : `${service.name} · 전체 (임시 ${temporary.length}개 제외)` } : {};
    if (await attempt(() => api.startRun(service.id, body))) goService(service.id, 'monitor');
  };
  const remove = async (list: TestCase[]) => {
    const done = await attempt(() => api.deleteTests(service.id, list.map((c) => ({ file: c.file, line: c.line }))));
    if (done) setPicked(new Set());
    await load();
  };
  const chosen = (cases ?? []).filter((c) => picked.has(c.id));

  if (cases === null)
    return (
      <Loading
        steps={['테스트 파일을 찾는 중…', 'Playwright에게 목록을 물어보는 중…', '기능별로 묶는 중…', '제목과 근거를 읽는 중…', '거의 다 됐어요…']}
        tips={['케이스를 골라서 일부만 실행할 수 있어요.', '검색창에 기능 이름이나 근거 문서를 넣어 찾아보세요.', '선택한 케이스는 우클릭 없이 바로 삭제할 수 있어요. 지운 케이스는 휴지통에 남습니다.', '실행이 끝나면 결과 · 결함 탭에서 원인 추정을 볼 수 있어요.']}
      />
    );

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">Claude가 작성한 테스트를 기능별로 모았습니다. 전체를 실행하거나 원하는 케이스만 골라 실행할 수 있습니다.</p>
        </div>
        <button className="btn btn-quiet btn-sm" onClick={() => void load()} disabled={loading}>
          <Icon name="refresh" size={14} />
          새로고침
        </button>
      </div>

      {errors.length > 0 && (
        <div className="callout callout-warn" role="alert">
          <div>
            <strong>{cases.length ? '일부 테스트 파일을 읽지 못했습니다.' : '테스트 목록을 불러오지 못했습니다.'}</strong>
            <p className="muted small">테스트 파일에 문법 오류가 있을 수 있습니다. Claude 세션에서 고쳐 달라고 하거나 새로고침해 보세요.</p>
            <details className="case-error-detail">
              <summary>오류 내용 보기</summary>
              <pre className="case-error">{errors.join('\n\n')}</pre>
            </details>
          </div>
        </div>
      )}

      {cases.length === 0 ? (
        <Empty
          title="아직 테스트 케이스가 없습니다"
          action={
            <a className="btn btn-primary" href={`#/s/${encodeURIComponent(service.id)}/sessions`}>
              Claude 세션에서 만들기
            </a>
          }
        >
          Claude 세션에서 <strong>테스트 작성</strong>을 누르면 지식 문서를 바탕으로 케이스가 만들어지고 여기에 나타납니다.
        </Empty>
      ) : (
        <>
          <div className="case-bar">
            <label className="case-check">
              <input type="checkbox" checked={allVisiblePicked} ref={(el) => void (el && (el.indeterminate = picked.size > 0 && !allVisiblePicked))} onChange={(e) => setMany(visible, e.target.checked)} aria-label="보이는 케이스 모두 선택" />
              <span>{picked.size ? `${picked.size}개 선택` : `${real.length}개 케이스`}</span>
            </label>
            <input type="search" className="case-search" aria-label="케이스 검색" placeholder="제목, 기능, 근거로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
            <span className="spacer" />
            <button className="btn btn-quiet" disabled={chosen.length === 0} onClick={() => setDeleting(chosen)}>
              <Icon name="trash" size={14} />
              선택 삭제
            </button>
            <button className="btn btn-primary" disabled={running || chosen.length === 0} onClick={() => void start(chosen)} title={running ? '다른 실행이 진행 중입니다' : undefined}>
              <Icon name="play" size={14} />
              선택한 {chosen.length}개 실행
            </button>
            <button className="btn" disabled={running || real.length === 0} onClick={() => void start(null)} title={running ? '다른 실행이 진행 중입니다' : temporary.length ? `임시 탐색 파일 ${temporary.length}개는 빼고 실행합니다` : undefined}>
              전체 실행
            </button>
          </div>

          {visible.length === 0 && visibleTemporary.length === 0 && <p className="muted small">검색 결과가 없습니다.</p>}
          {groups.map(([feature, list]) => {
            const all = list.every((c) => picked.has(c.id));
            const some = list.some((c) => picked.has(c.id));
            return (
              <details key={feature} className="panel case-group" open>
                <summary>
                  <Icon name="chevron" size={14} />
                  <input
                    type="checkbox"
                    checked={all}
                    ref={(el) => void (el && (el.indeterminate = some && !all))}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setMany(list, e.target.checked)}
                    aria-label={`${feature} 전체 선택`}
                  />
                  <strong className="ellipsis">{feature}</strong>
                  <span className="count">{list.length}</span>
                </summary>
                <ul className="case-list">
                  {list.map((c) => (
                    <li key={c.id}>
                      <div className="case-line">
                        {c.steps.length > 0 ? (
                          <button type="button" className={`case-toggle${opened.has(c.id) ? ' open' : ''}`} onClick={() => toggleOpen(c.id)} aria-expanded={opened.has(c.id)} aria-label={`${c.title} 단계 ${opened.has(c.id) ? '접기' : '펼치기'}`}>
                            <Icon name="chevron" size={14} />
                          </button>
                        ) : (
                          <span className="case-toggle-gap" />
                        )}
                        <label className="case-row">
                          <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => setMany([c], e.target.checked)} />
                          <span className="case-main">
                            <span className="case-title">
                              {c.title}
                              {c.steps.length > 0 && <span className="case-steps-count">{c.steps.length}단계</span>}
                              {c.tags.map((t) => (
                                <Pill key={t} tone="accent">
                                  {t.replace(/^@/, '')}
                                </Pill>
                              ))}
                            </span>
                            {c.source && <span className="case-source">근거 · {c.source}</span>}
                          </span>
                          <code className="case-file">
                            {c.file}:{c.line}
                          </code>
                        </label>
                      </div>
                      {opened.has(c.id) && (
                        <ol className="case-steps">
                          {c.steps.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}

          {visibleTemporary.length > 0 && (
            <details className="panel case-group case-temp">
              <summary>
                <Icon name="chevron" size={14} />
                <strong className="ellipsis">임시 탐색 파일</strong>
                <span className="count">{visibleTemporary.length}</span>
              </summary>
              <div className="case-temp-note">
                <p className="muted small">Claude가 화면을 살펴보려고 만든 파일로 보입니다. 전체 실행과 위의 개수에서는 빠져 있습니다. 필요 없으면 지워도 됩니다(휴지통으로 이동).</p>
                <button className="btn btn-sm" onClick={() => setDeleting(visibleTemporary)}>
                  <Icon name="trash" size={14} />
                  임시 파일 {visibleTemporary.length}개 삭제
                </button>
              </div>
              <ul className="case-list">
                {visibleTemporary.map((c) => (
                  <li key={c.id}>
                    <label className="case-row">
                      <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => setMany([c], e.target.checked)} />
                      <span className="case-main">
                        <span className="case-title">
                          {c.title}
                          <Pill tone="neutral">임시</Pill>
                        </span>
                      </span>
                      <code className="case-file">
                        {c.file}:{c.line}
                      </code>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {deleting && (
        <ConfirmModal title="테스트 케이스 삭제" confirm="삭제 (휴지통으로 이동)" onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)}>
          선택한 {deleting.length}개 케이스를 삭제합니다. 파일의 케이스를 모두 지우면 그 파일이, 일부만 지우면 지우기 전 파일이 이 컴퓨터의 휴지통으로 이동하므로, 휴지통에서 복원할 수 있습니다. 삭제 후에는 Probe 안에서 되돌릴 수 없습니다.
        </ConfirmModal>
      )}
    </>
  );
}
