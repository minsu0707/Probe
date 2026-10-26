import { useState } from 'react';
import { Empty, Icon } from '../../ui/index.ts';
import { AddServiceModal } from './AddServiceModal.tsx';

/** Home before any service exists. */
export function Welcome() {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Empty
        title="등록된 서비스가 없습니다"
        action={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />첫 서비스 등록
          </button>
        }
      >
        서비스 이름과 주소를 입력하고 <code>.env</code> 또는 <code>.enc</code> 파일을 올리면 바로 테스트할 수 있습니다.
      </Empty>
      {adding && <AddServiceModal onClose={() => setAdding(false)} />}
    </>
  );
}
