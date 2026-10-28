import { useRef, useState } from 'react';
import { api } from '../../core/api.ts';
import { attempt, toast } from '../../core/store.ts';
import { ConfirmModal } from '../../ui/index.ts';
import { Group, Row } from './Rows.tsx';

const MB = 1024 * 1024;
const MIN_PASSPHRASE = 8;

interface Staged {
  createdAt: number;
  appVersion: string;
  services: number;
}

/** 백업: everything Probe keeps in one passphrase-protected file, and the way back from it. */
export function BackupSection() {
  return (
    <>
      <CreateGroup />
      <RestoreGroup />
    </>
  );
}

function CreateGroup() {
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [withClaude, setWithClaude] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const ok = pass.length >= MIN_PASSPHRASE && pass === again;

  const create = async () => {
    setBusy(true);
    setDone(null);
    const file = await attempt(() => api.createBackup({ passphrase: pass, includeClaudeContext: withClaude }));
    setBusy(false);
    if (!file) return;
    // A plain link click: the window saves it like any download.
    const a = document.createElement('a');
    a.href = `/api/backup/download/${file.id}`;
    a.download = file.name;
    a.click();
    setDone(`${file.name} (${(file.size / MB).toFixed(1)}MB)`);
    setPass('');
    setAgain('');
  };

  return (
    <Group title="백업 만들기">
      <Row title="무엇이 들어가나요" desc="모든 서비스의 설정, 환경 변수, 올린 문서, 학습한 지식, 테스트 코드, 결함과 답변, Claude 대화 기록, 실행 기록과 스크린샷. 환경 변수는 아래 비밀번호로 잠긴 파일 안에 함께 들어갑니다." />
      <Row title="비밀번호" desc={`백업 파일을 여는 비밀번호입니다 (${MIN_PASSPHRASE}자 이상). 잃어버리면 복원할 수 없습니다.`}>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="비밀번호" aria-label="백업 비밀번호" autoComplete="new-password" />
      </Row>
      <Row title="비밀번호 확인">
        <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} placeholder="한 번 더" aria-label="백업 비밀번호 확인" autoComplete="new-password" />
      </Row>
      <Row title="Claude 대화 맥락 포함" desc="Claude가 앞의 대화를 기억해서 이어가게 하는 파일입니다. Probe 전용 로그인을 쓸 때만 들어가며, 같은 사용자 이름의 컴퓨터에서 가장 잘 이어집니다. 로그인 정보는 어떤 경우에도 들어가지 않습니다.">
        <input type="checkbox" role="switch" className="switch" checked={withClaude} onChange={(e) => setWithClaude(e.target.checked)} aria-label="Claude 대화 맥락 포함" />
      </Row>
      <Row title={done ? '백업을 만들었습니다' : '백업 파일 만들기'} desc={done ?? (pass && again && pass !== again ? '두 비밀번호가 다릅니다.' : '저장 위치를 묻는 창이 열립니다.')}>
        <button className="btn btn-primary" onClick={() => void create()} disabled={!ok || busy}>
          {busy ? '만드는 중…' : '백업 만들기'}
        </button>
      </Row>
    </Group>
  );
}

function RestoreGroup() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [restarting, setRestarting] = useState(false);

  const prepare = async () => {
    if (!file) return;
    setBusy(true);
    const manifest = await attempt(() => api.stageRestore(file, pass));
    setBusy(false);
    if (manifest) setStaged(manifest);
  };

  const restart = async () => {
    if (!(await attempt(() => api.restartApp()))) return;
    setRestarting(true);
    toast('Probe를 다시 시작합니다. 몇 초 뒤에도 열리지 않으면 Probe를 직접 실행하세요.');
  };

  return (
    <Group title="백업에서 복원">
      <Row title="백업 파일" desc="복원하면 이 컴퓨터의 현재 데이터가 백업의 내용으로 바뀝니다. 바뀌기 직전의 데이터는 데이터 폴더의 restore-undo에 최근 2회분이 남습니다.">
        <input ref={input} type="file" accept=".probebak" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className="btn" onClick={() => input.current?.click()}>
          {file ? file.name : '파일 선택'}
        </button>
      </Row>
      <Row title="비밀번호">
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="백업할 때 정한 비밀번호" aria-label="복원 비밀번호" autoComplete="off" />
      </Row>
      <Row title="복원 준비" desc={staged ? '파일을 확인했습니다. 다시 시작하면 복원이 끝납니다.' : '파일을 열어 확인만 합니다. 다시 시작하기 전에는 아무것도 바뀌지 않습니다.'}>
        <button className="btn btn-primary" onClick={() => void prepare()} disabled={!file || !pass || busy}>
          {busy ? '확인하는 중…' : '확인하기'}
        </button>
      </Row>

      {staged && !restarting && (
        <ConfirmModal title="이 백업으로 복원" confirm="다시 시작하고 복원" onConfirm={restart} onClose={() => setStaged(null)}>
          {new Date(staged.createdAt).toLocaleString('ko-KR')}에 만든 백업(Probe {staged.appVersion}, 서비스 {staged.services}개)으로 바꿉니다. 지금 이 컴퓨터의 데이터는 restore-undo에 보관됩니다. 진행 중인 작업이 있으면 먼저 끝내거나 중단해야 합니다. Probe가 다시 시작됩니다.
        </ConfirmModal>
      )}
    </Group>
  );
}
