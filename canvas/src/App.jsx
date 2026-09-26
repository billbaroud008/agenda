import { useEffect, useCallback } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, useReactFlow } from '@xyflow/react';
import { useStore } from './store.js';
import { resumeAll } from './runner.js';
import { initDisk } from './disk.js';
import ImageNode from './nodes/ImageNode.jsx';
import VideoNode from './nodes/VideoNode.jsx';
import ImportNode, { importFile as importImage } from './nodes/ImportNode.jsx';
import NoteNode from './nodes/NoteNode.jsx';
import Toolbar from './Toolbar.jsx';

const nodeTypes = { image: ImageNode, video: VideoNode, import: ImportNode, note: NoteNode };

// Une sortie image ne va que vers une entrée image (réf. d'un nœud Image ou entrée d'un nœud Vidéo).
function isValidConnection(c) {
  if (c.source === c.target || c.sourceHandle !== 'out' || !['refs', 'images'].includes(c.targetHandle)) return false;
  const { boards, activeId } = useStore.getState();
  return !boards[activeId].edges.some((e) => e.source === c.source && e.target === c.target);
}

function Canvas() {
  const board = useStore((s) => s.boards[s.activeId]);
  const { onNodesChange, onEdgesChange, onConnect, setViewport, addNode } = useStore.getState();
  const rf = useReactFlow();

  const onDrop = useCallback(async (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    for (const [i, f] of files.entries()) {
      const mediaId = await importImage(f);
      addNode('import', { x: pos.x + i * 30, y: pos.y + i * 30 }, { mediaId, name: f.name });
    }
  }, [rf, addNode]);

  if (!board) return null;
  return (
    <ReactFlow
      nodes={board.nodes}
      edges={board.edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      defaultViewport={board.viewport}
      onMoveEnd={(_, vp) => setViewport(vp)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      deleteKeyCode={['Backspace', 'Delete']}
      minZoom={0.1}
      maxZoom={3}
      defaultEdgeOptions={{ style: { strokeWidth: 2 } }}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      <Background gap={24} />
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const activeId = useStore((s) => s.activeId);

  useEffect(() => {
    useStore.getState().init().then(initDisk).then(resumeAll);
  }, []);

  if (!ready) return <div className="loading">Chargement…</div>;
  return (
    <ReactFlowProvider key={activeId}>
      <div className="app">
        <Toolbar />
        <div className="canvas"><Canvas /></div>
      </div>
    </ReactFlowProvider>
  );
}
