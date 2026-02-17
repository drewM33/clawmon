import { useRef, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as d3 from 'd3';
import { useGraph } from '../../hooks/useApi';
import { useWSEvent } from '../../hooks/useWebSocket';
import type { GraphNode, GraphEdge } from '../../types';
import { TIER_COLORS } from '../../types';

interface SimNode extends d3.SimulationNodeDatum, GraphNode {}
interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  value: number;
  isMutual: boolean;
}

export default function NetworkGraph() {
  const svgRef = useRef<SVGSVGElement>(null);
  const { data: graph, loading, error, refetch } = useGraph();
  const navigate = useNavigate();
  const [showReviewers, setShowReviewers] = useState(false);
  const [highlightSybil, setHighlightSybil] = useState(true);

  // Refetch graph data when WebSocket signals graph changes
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useWSEvent('graph:updated', useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      refetch();
    }, 500);
  }, [refetch]));

  useEffect(() => {
    if (!graph || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = svgRef.current.parentElement;
    const width = container?.clientWidth ?? 900;
    const height = container?.clientHeight ?? 600;

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    // Filter nodes/edges based on controls
    let nodes: SimNode[] = graph.nodes
      .filter(n => showReviewers || n.type === 'agent')
      .map(n => ({ ...n }));

    const nodeIds = new Set(nodes.map(n => n.id));
    let links: SimLink[] = graph.edges
      .filter(e => nodeIds.has(e.source as string) && nodeIds.has(e.target as string))
      .map(e => ({ ...e }));

    // Sybil cluster set
    const sybilSet = new Set<string>();
    if (highlightSybil) {
      for (const cluster of graph.sybilClusters) {
        for (const id of cluster) sybilSet.add(id);
      }
    }

    // Force simulation
    const simulation = d3.forceSimulation<SimNode>(nodes)
      .force('link', d3.forceLink<SimNode, SimLink>(links)
        .id(d => d.id)
        .distance(d => d.isMutual ? 40 : 80)
        .strength(d => d.isMutual ? 0.8 : 0.3))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(20));

    // Zoom
    const g = svg.append('g');
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoom);

    // Edges
    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', d => d.isMutual ? '#ef4444' : '#374151')
      .attr('stroke-width', d => d.isMutual ? 2.5 : 0.8)
      .attr('stroke-opacity', d => d.isMutual ? 0.8 : 0.3)
      .attr('stroke-dasharray', d => d.isMutual ? '6,3' : 'none');

    // Nodes
    const node = g.append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', d => d.type === 'agent' ? 'pointer' : 'default')
      .on('click', (_event, d) => {
        if (d.type === 'agent') {
          navigate(`/agent/${encodeURIComponent(d.id)}`);
        }
      })
      .call(d3.drag<SVGGElement, SimNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

    // Node circles
    node.append('circle')
      .attr('r', d => {
        if (d.type === 'reviewer') return 4;
        const count = d.feedbackCount ?? 0;
        return Math.max(8, Math.min(20, 8 + count * 0.3));
      })
      .attr('fill', d => {
        if (sybilSet.has(d.id)) return '#ef4444';
        if (d.isFlagged) return '#f97316';
        if (d.type === 'reviewer') return '#6b7280';
        if (d.tier) return TIER_COLORS[d.tier] ?? '#6b7280';
        return '#3b82f6';
      })
      .attr('stroke', d => {
        if (sybilSet.has(d.id)) return '#fca5a5';
        if (d.isFlagged) return '#fed7aa';
        return '#1f2937';
      })
      .attr('stroke-width', d => sybilSet.has(d.id) ? 3 : 1.5);

    // Sybil pulse animation
    node.filter(d => sybilSet.has(d.id))
      .append('circle')
      .attr('r', d => {
        if (d.type === 'reviewer') return 8;
        const count = d.feedbackCount ?? 0;
        return Math.max(12, Math.min(28, 12 + count * 0.3));
      })
      .attr('fill', 'none')
      .attr('stroke', '#ef4444')
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.4);

    // Labels for agent nodes
    node.filter(d => d.type === 'agent')
      .append('text')
      .text(d => d.label.length > 16 ? d.label.slice(0, 14) + '…' : d.label)
      .attr('x', 0)
      .attr('y', d => {
        const count = d.feedbackCount ?? 0;
        return -(Math.max(8, Math.min(20, 8 + count * 0.3)) + 6);
      })
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('font-family', "'Inter', sans-serif")
      .attr('fill', d => sybilSet.has(d.id) ? '#fca5a5' : d.isFlagged ? '#fed7aa' : '#d1d5db')
      .attr('font-weight', d => sybilSet.has(d.id) || d.isFlagged ? '600' : '400');

    // Simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as SimNode).x ?? 0)
        .attr('y1', d => (d.source as SimNode).y ?? 0)
        .attr('x2', d => (d.target as SimNode).x ?? 0)
        .attr('y2', d => (d.target as SimNode).y ?? 0);

      node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [graph, showReviewers, highlightSybil, navigate]);

  if (loading) return <div className="loading">Loading network graph...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div className="network-graph">
      <div className="graph-header">
        <h2>Feedback Network</h2>
        <p className="subtitle">
          Feedback relationships between agents and reviewers.
          <span className="sybil-highlight"> Red clusters = detected sybil rings.</span>
        </p>
      </div>
      <div className="graph-controls">
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={showReviewers}
            onChange={e => setShowReviewers(e.target.checked)}
          />
          Show Reviewer Nodes
        </label>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={highlightSybil}
            onChange={e => setHighlightSybil(e.target.checked)}
          />
          Highlight Sybil Clusters
        </label>
      </div>
      <div className="graph-legend">
        <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#22c55e' }} /> Legitimate Agent</span>
        <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#ef4444' }} /> Sybil Cluster</span>
        <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#f97316' }} /> Flagged (Malicious)</span>
        <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#6b7280' }} /> Reviewer</span>
        <span className="legend-item"><span className="legend-line mutual" /> Mutual Feedback</span>
      </div>
      <div className="graph-container">
        <svg ref={svgRef} className="graph-svg" />
      </div>
    </div>
  );
}
