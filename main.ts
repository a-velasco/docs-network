import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import louvain from "graphology-communities-louvain";
import iwanthue from "iwanthue";
import { bindWebGLLayer, createContoursProgram } from "@sigma/layer-webgl";
import type { Coordinates, EdgeDisplayData, NodeDisplayData } from "sigma/types";

interface State {
  hoveredNode?: string;
  selectedNode?: string;
  hoveredNeighborhood?: Set<string>;
  selectedNeighborhood?: Set<string>;
  activeCommunities: Set<string>;
  hoverDepth: number;
}

// Returns or creates the top-left sidebar container to stack controls vertically.
// TODO: transfer to index.html
function getOrCreateLeftPanel(): HTMLElement {
  let panel = document.getElementById("left-controls") as HTMLElement;
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "left-controls";
    panel.style.position = "absolute";
    panel.style.top = "10px";
    panel.style.left = "10px";
    panel.style.zIndex = "10";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.gap = "8px";
    panel.style.fontFamily = "sans-serif";
    document.body.appendChild(panel);
  }
  return panel;
}

// Ensures the Search Bar element exists in the DOM inside the left sidebar.
// TODO: transfer to index.html
function setupSearchUI(): {
  searchInput: HTMLInputElement;
  searchSuggestions: HTMLDataListElement;
} {
  const leftPanel = getOrCreateLeftPanel();

  let inputContainer = document.getElementById("search-container") as HTMLElement;
  if (!inputContainer) {
    inputContainer = document.createElement("div");
    inputContainer.id = "search-container";
    inputContainer.style.background = "rgba(255, 255, 255, 0.9)";
    inputContainer.style.padding = "8px 12px";
    inputContainer.style.borderRadius = "8px";
    inputContainer.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";

    inputContainer.innerHTML = `
      <label for="search-input" style="font-weight: 600; display: block; margin-bottom: 4px; font-size: 13px;">
        Search nodes
      </label>
      <input type="text" id="search-input" list="suggestions" placeholder="Search page..." style="width: 160px; padding: 4px 6px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px;" />
      <datalist id="suggestions"></datalist>
    `;
    leftPanel.appendChild(inputContainer);
  }

  const searchInput = document.getElementById("search-input") as HTMLInputElement;
  const searchSuggestions = document.getElementById("suggestions") as HTMLDataListElement;

  return { searchInput, searchSuggestions };
}

// TODO: transfer to index.html
function setupHoverDepthUI(initialDepth: number, onChange: (newDepth: number) => void) {
  const leftPanel = getOrCreateLeftPanel();

  let panel = document.getElementById("hover-depth-panel") as HTMLElement;
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "hover-depth-panel";
    panel.style.background = "rgba(255, 255, 255, 0.9)";
    panel.style.padding = "8px 12px";
    panel.style.borderRadius = "8px";
    panel.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
    panel.style.fontSize = "13px";
    leftPanel.appendChild(panel);
  }

  panel.innerHTML = `
    <label for="hover-depth-slider" style="font-weight: 600; display: block; margin-bottom: 4px;">
      Hover depth: <span id="depth-val">${initialDepth}</span> hop(s)
    </label>
    <input type="range" id="hover-depth-slider" min="1" max="3" value="${initialDepth}" style="width: 160px; cursor: pointer;" />
  `;

  const slider = panel.querySelector("#hover-depth-slider") as HTMLInputElement;
  const depthVal = panel.querySelector("#depth-val") as HTMLSpanElement;

  slider.addEventListener("input", () => {
    const val = parseInt(slider.value, 3);
    depthVal.textContent = String(val);
    onChange(val);
  });
}

// Breadth-First Search (BFS) to gather all nodes within `maxDepth` hops.
function getNHopNeighborhood(graph: Graph, startNode: string, maxDepth: number = 3): Set<string> {
  const visited = new Set<string>([startNode]);
  let currentLevel = [startNode];

  for (let depth = 0; depth < maxDepth; depth++) {
    if (currentLevel.length === 0) break;
    const nextLevel: string[] = [];

    for (const node of currentLevel) {
      graph.forEachNeighbor(node, (neighbor) => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextLevel.push(neighbor);
        }
      });
    }

    currentLevel = nextLevel;
  }

  return visited;
}

// Assigns Louvain community attributes
function applyLouvainCommunities(graph: Graph) {
  louvain.assign(graph, { nodeCommunityAttribute: "community" });

  const communityCounts: Record<string, number> = {};
  graph.forEachNode((_, attrs) => {
    const comm = String(attrs.community);
    communityCounts[comm] = (communityCounts[comm] || 0) + 1;
  });

  const multiMemberCommunities = Object.keys(communityCounts).filter(
    (comm) => communityCounts[comm] > 1
  );

  const colors = iwanthue(multiMemberCommunities.length);
  const palette: Record<string, string> = {};

  multiMemberCommunities.forEach((comm, i) => {
    palette[comm] = colors[i];
  });

  return { palette, multiMemberCommunities };
}
interface State {
  hoveredNode?: string;
  selectedNode?: string;
  hoveredNeighborhood?: Set<string>;
  selectedNeighborhood?: Set<string>;
  activeCommunities: Set<string>;
  hoverDepth: number;
}

// Renders UI checkboxes that toggle WebGL contours
// TODO: transfer to index.html
function setupCommunityContoursUI(
  graph: Graph,
  renderer: Sigma,
  communities: string[],
  palette: Record<string, string>,
  state: State
) {
  let panel = document.getElementById("community-panel") as HTMLElement;
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "community-panel";
    panel.style.position = "absolute";
    panel.style.right = "10px";
    panel.style.bottom = "10px";
    panel.style.zIndex = "10";
    panel.style.background = "rgba(255, 255, 255, 0.9)";
    panel.style.padding = "10px";
    panel.style.borderRadius = "8px";
    panel.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
    panel.style.fontFamily = "sans-serif";
    document.body.appendChild(panel);
  }

  panel.innerHTML = "";
  const layerCleaners: Record<string, (() => void) | null> = {};

  communities.forEach((community) => {
    const id = `cb-community-${community}`;
    const checkboxContainer = document.createElement("div");
    checkboxContainer.style.marginBottom = "4px";

    checkboxContainer.innerHTML = `
      <input type="checkbox" id="${id}" />
      <label for="${id}" style="color: ${palette[community] || "#333"}; font-weight: 600; margin-left: 6px; cursor: pointer; font-size: 13px;">
        Community #${Number(community) + 1}
      </label>
    `;

    panel.appendChild(checkboxContainer);
    const checkbox = checkboxContainer.querySelector(`#${id}`) as HTMLInputElement;

    const toggle = () => {
      const commStr = String(community);
      const clean = layerCleaners[community];

      if (clean) {
        clean();
        layerCleaners[community] = null;
        state.activeCommunities.delete(commStr);
      } else {
        layerCleaners[community] = bindWebGLLayer(
          `community-${community}`,
          renderer,
          createContoursProgram(
            graph.filterNodes((_, attr) => String(attr.community) === commStr),
            {
              radius: 30,
              border: { color: palette[community], thickness: 5 },
              levels: [{ color: "#00000000", threshold: 0.5 }],
            }
          )
        );
        state.activeCommunities.add(commStr);
      }

      // Re-evaluate nodeReducer rules
      renderer.refresh({ skipIndexation: true });
    };

    checkbox.addEventListener("change", toggle);
  });
}

// State management for hover effects, persistent node selection on click and camera nav
function setupInteractionState(graph: Graph, renderer: Sigma): State {
  const { searchInput, searchSuggestions } = setupSearchUI();

  const state: State = {
    hoverDepth: 1,
    activeCommunities: new Set<string>(),
  };

  // Populate search datalist
  if (searchSuggestions) {
    searchSuggestions.innerHTML = graph
      .nodes()
      .map((node) => `<option value="${graph.getNodeAttribute(node, "label") || ""}"></option>`)
      .join("\n");
  }

  // Search input navigation
  // TODO: fix
  if (searchInput) {
    searchInput.addEventListener("change", () => {
      const query = searchInput.value.trim().toLowerCase();
      if (!query) return;

      const match = graph.nodes().find((node) => {
        const label = (graph.getNodeAttribute(node, "label") as string) || "";
        return label.toLowerCase() === query;
      });

      if (match) {
        state.selectedNode = match;
        state.selectedNeighborhood = getNHopNeighborhood(graph, match, state.hoverDepth);

        const nodePosition = renderer.getNodeDisplayData(match) as Coordinates;
        if (nodePosition) {
          renderer.getCamera().animate(nodePosition, { duration: 500 });
        }
        renderer.refresh({ skipIndexation: true });
      }
    });
  }

  setupHoverDepthUI(state.hoverDepth, (newDepth) => {
    state.hoverDepth = newDepth;

    if (state.hoveredNode) {
      state.hoveredNeighborhood = getNHopNeighborhood(graph, state.hoveredNode, state.hoverDepth);
    }
    if (state.selectedNode) {
      state.selectedNeighborhood = getNHopNeighborhood(graph, state.selectedNode, state.hoverDepth);
    }
    renderer.refresh({ skipIndexation: true });
  });

  // Hover Events
  renderer.on("enterNode", ({ node }) => {
    state.hoveredNode = node;
    state.hoveredNeighborhood = getNHopNeighborhood(graph, node, state.hoverDepth);
    renderer.refresh({ skipIndexation: true });
  });

  renderer.on("leaveNode", () => {
    state.hoveredNode = undefined;
    state.hoveredNeighborhood = undefined;
    renderer.refresh({ skipIndexation: true });
  });

  renderer.on("clickNode", ({ node }) => {
    state.selectedNode = node;
    state.selectedNeighborhood = getNHopNeighborhood(graph, node, state.hoverDepth);
    renderer.refresh({ skipIndexation: true });
  });

  renderer.on("clickStage", () => {
    state.selectedNode = undefined;
    state.selectedNeighborhood = undefined;
    renderer.refresh({ skipIndexation: true });
  });

  renderer.setSetting("nodeReducer", (node, data) => {
    const res: Partial<NodeDisplayData> = { ...data };
    const nodeComm = String(graph.getNodeAttribute(node, "community"));
    const hasActiveCommunities = state.activeCommunities.size > 0;
    const isInActiveCommunity = hasActiveCommunities && state.activeCommunities.has(nodeComm);

    // Active neighborhood (Hover takes priority over click)
    const activeNeighborhood = state.hoveredNeighborhood || state.selectedNeighborhood;
    if (activeNeighborhood) {
      if (activeNeighborhood.has(node)) {
        // res.forceLabel = true;
      } else {
        res.color = "#D8D8D8";
        res.label = "";
      }
    } else if (hasActiveCommunities && !isInActiveCommunity && state.hoveredNode !== node) {
      // Dim nodes outside active community contours when community checkboxes are active
      res.color = "#D8D8D8";
      res.label = "";
    }

    return res;
  });

  return state;
}

function setupFA2Control(graph: Graph, button: HTMLButtonElement) {
  const leftPanel = getOrCreateLeftPanel();

  // Style and re-parent the ForceAtlas2 button directly into the stacked left panel
  button.style.padding = "6px 12px";
  button.style.borderRadius = "8px";
  button.style.border = "none";
  button.style.background = "rgba(255, 255, 255, 0.9)";
  button.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
  button.style.cursor = "pointer";
  button.style.fontSize = "13px";

  // Insert button right after search input
  const searchContainer = document.getElementById("search-container");
  if (searchContainer && searchContainer.nextSibling) {
    leftPanel.insertBefore(button, searchContainer.nextSibling);
  } else {
    leftPanel.appendChild(button);
  }

  const inferred = forceAtlas2.inferSettings(graph);

  const settings = {
    ...inferred,
    gravity: 1.0,
    strongGravityMode: true,
    scalingRatio: 8.0,
    linLogMode: false,
  };

  const fa2Layout = new FA2Layout(graph, { settings });

  let autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  function stop() {
    fa2Layout.stop();
    button.textContent = "Simulate graph forces";
    button.classList.remove("active");
    if (autoStopTimer) clearTimeout(autoStopTimer);
  }

  function start() {
    fa2Layout.start();
    button.textContent = "Stop simulating"; // TODO: fix disappearing text
    button.classList.add("active");

    autoStopTimer = setTimeout(stop, 10000);
  }

  button.addEventListener("click", () => {
    if (fa2Layout.isRunning()) {
      stop();
    } else {
      start();
    }
  });
}

async function init() {
  try {
    const response = await fetch("graph.json");
    const data = await response.json();

    const graph = new Graph();
    graph.import(data);

    // Force one short Force Atlas 2 layout computation on init
    const inferred = forceAtlas2.inferSettings(graph);
    const settings = {
      ...inferred,
      gravity: 1.0,
      strongGravityMode: true,
      scalingRatio: 8.0,
    };

    forceAtlas2.assign(graph, {
      iterations: 100,
      settings: settings,
    });

    const { palette, multiMemberCommunities } = applyLouvainCommunities(graph);

    const container = document.getElementById("container") as HTMLElement;
    const renderer = new Sigma(graph, container);

    const state = setupInteractionState(graph, renderer);
    setupCommunityContoursUI(graph, renderer, multiMemberCommunities, palette, state);

    const fa2Button = document.getElementById("forceatlas2") as HTMLButtonElement;
    if (fa2Button) {
      setupFA2Control(graph, fa2Button);
    }
  } catch (err) {
    console.error("Failed to initialize graph renderer:", err);
  }
}

init();