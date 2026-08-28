// ─── Shared types: contract between collector (browser), analyzer (node), renderer (node) ───

// ---- Metrics ----

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Metrics {
  rect: Rect;
  rectBottom: number;
  rectRight: number;
  offsetHeight: number;
  clientHeight: number;
  scrollHeight: number;
  clientWidth: number;
  scrollWidth: number;
}

export interface Flags {
  overflowsViewport: boolean;
  overflowsParent: boolean;
  hasScrollY: boolean;
  hasScrollX: boolean;
  scrollable: boolean;
}

// ---- Computed & declared styles ----

/** A declared value found in a stylesheet rule, with provenance. */
export interface DeclaredValue {
  selector: string;
  value: string;
  href: string;
  /** Whether the owning stylesheet was readable (cross-origin sheets are not). */
  accessible: boolean;
}

export interface NodeProps {
  position: string;
  display: string;
  height: string;
  width: string;
  minHeight: string;
  maxHeight: string;
  overflowY: string;
  overflowX: string;
  boxSizing: string;
  flexDirection: string;
  flexGrow: string;
  flexShrink: string;
  flexBasis: string;
  minWidth?: string;
  opacity?: string;
  visibility?: string;
  zIndex?: string;
  margin?: string;
  padding?: string;
  float?: string;
  transform?: string;
  filter?: string;
  perspective?: string;
  willChange?: string;
  contain?: string;
  [key: string]: string | undefined;
}

// ---- Shape classification (output of classifier, input to analyzer) ----

export interface ShapeInfo {
  role: string;
  scrollTag: string;
  heightStrategy: string;
  widthStrategy: string;
  isFlexChild: boolean;
}

// ---- Tree nodes ----

export interface TreeNode {
  tag: string;
  id: string | null;
  classes: string[];
  inlineStyle: string | null;
  text: string;
  props: NodeProps;
  declared: Record<string, DeclaredValue[]>;
  shape: ShapeInfo;
  metrics: Metrics;
  flags: Flags;
  containingBlockModifiers: string[];
  children: TreeNode[];
  repeat?: number;
}

export interface AncestorNode {
  label: string;
  props: NodeProps;
  metrics: Metrics;
  flags: Flags;
  declared: Record<string, DeclaredValue[]>;
  shape: ShapeInfo;
  containingBlockModifiers: string[];
  inlineStyle: string | null;
}

// ---- Collector config & output ----

export interface CollectConfig {
  rootSelector: string;
  upTo: string;
  downDepth: number;
  maxNodes: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface Snapshot {
  rootSelector: string;
  upTo: string;
  downDepth: number;
  maxNodes: number;
  nodeCount: number;
  viewport: ViewportSize;
  ancestors: AncestorNode[];
  tree: TreeNode | null;
  crossOriginBlocked: number;
  blockedSheetUrls: string[];
  error?: string;
  candidates?: string[];
}

// ---- Findings (output of analyzer) ----

export type Confidence = 'DEFINITE' | 'INDEFINITE' | 'UNVERIFIABLE';

export interface Evidence {
  type: 'computed' | 'declared' | 'pattern';
  property?: string;
  value?: string;
  source?: string;
  accessible?: boolean;
}

export interface Finding {
  id: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  confidence: Confidence;
  evidence: Evidence[];
  location?: string;
}
