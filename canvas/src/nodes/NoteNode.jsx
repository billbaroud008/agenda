import { NodeResizer } from '@xyflow/react';
import { patchActive } from '../store.js';
import { CloseButton } from './common.jsx';

export default function NoteNode({ id, data, selected }) {
  return (
    <div className={`node note ${selected ? 'selected' : ''}`}>
      <CloseButton id={id} />
      <NodeResizer isVisible={selected} minWidth={140} minHeight={80} />
      <textarea
        className="nodrag nowheel"
        placeholder="Note…"
        value={data.text}
        onChange={(e) => patchActive(id, { text: e.target.value })}
      />
    </div>
  );
}
