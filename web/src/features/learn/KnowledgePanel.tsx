import { useEffect, useState } from 'react';
import { api, type KnowledgeFile } from '../../core/api.ts';
import { attempt } from '../../core/store.ts';
import { Empty, Icon, Markdown } from '../../ui/index.ts';

/** Tab labels for the files the learning job writes. Unknown files fall back to their file name. */
const FILE_LABEL: Record<string, string> = {
  'overview.md': '개요',
  'screens.md': '화면',
  'flows.md': '업무 흐름',
  'rules.md': '규칙',
  'test-points.md': '테스트 포인트',
  'open-questions.md': '미확인 사항',
};

/** 지식 문서: read what Claude learned, or fix it by hand. */
export function KnowledgePanel({ serviceId, files, onSaved }: { serviceId: string; files: KnowledgeFile[]; onSaved: (f: KnowledgeFile) => void }) {
  const [active, setActive] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const file = files.find((f) => f.name === active) ?? files[0];

  // Switching tabs abandons an unsaved edit.
  useEffect(() => setEditing(false), [file?.name]);

  if (!file) {
    return (
      <section className="panel">
        <h2>지식 문서</h2>
        <Empty title="아직 학습한 내용이 없습니다">
          자료를 올리고 <strong>학습 시작</strong>을 누르면 개요, 화면, 업무 흐름, 규칙, 테스트 포인트가 문서로 정리됩니다. Claude가 테스트 코드를 쓸 때 이 문서를 먼저 읽습니다.
        </Empty>
      </section>
    );
  }

  const save = async () => {
    if (await attempt(() => api.saveKnowledge(serviceId, file.name, draft), '저장했습니다')) {
      onSaved({ ...file, content: draft, updatedAt: Date.now() });
      setEditing(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>지식 문서</h2>
        {editing ? (
          <div className="actions">
            <button className="btn btn-primary btn-sm" onClick={save}>
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
