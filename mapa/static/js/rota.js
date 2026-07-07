export function parseGraphData(nodesDict, edgesDict, goalId, edgeSeparator = ',') {
  const graph = {};
  const heuristics = {};

  for (const nodeId in nodesDict) {
    graph[nodeId] = {};
  }

  for (const edgeKey in edgesDict) {
    const [nodeA, nodeB] = edgeKey.split(edgeSeparator);
    
    const pathObj = edgesDict[edgeKey];
    const weight = pathObj.distance ?? pathObj.weight ?? 1;

    if (graph[nodeA]) graph[nodeA][nodeB] = weight;
    if (graph[nodeB]) graph[nodeB][nodeA] = weight;
  }

  const goalNode = nodesDict[goalId];
  
  if (goalNode) {
    for (const nodeId in nodesDict) {
      const currentNode = nodesDict[nodeId];
      
      const dx = goalNode.pos.x - currentNode.pos.x;
      const dy = goalNode.pos.y - currentNode.pos.y;
      
      heuristics[nodeId] = Math.sqrt(dx * dx + dy * dy);
    }
  }

  return { graph, heuristics };
}

export class AStar {
  static findPath(graph, start, goal, heuristics) {
    const openSet = new Set([start]);

    const cameFrom = new Map();

    const gScore = new Map();
    gScore.set(start, 0);

    const fScore = new Map();
    fScore.set(start, heuristics[start] || 0);

    while (openSet.size > 0) {
      const current = this._getLowestFScore(openSet, fScore);

      if (current === goal) {
        return this._reconstructPath(cameFrom, current);
      }

      openSet.delete(current);

      const neighbors = graph[current] || {};
      for (const neighbor in neighbors) {
        const weight = neighbors[neighbor];
        const tentativeGScore = (gScore.get(current) ?? Infinity) + weight;

        if (tentativeGScore < (gScore.get(neighbor) ?? Infinity)) {
          cameFrom.set(neighbor, current);
          gScore.set(neighbor, tentativeGScore);
          
          const hScore = heuristics[neighbor] || 0;
          fScore.set(neighbor, tentativeGScore + hScore);

          if (!openSet.has(neighbor)) {
            openSet.add(neighbor);
          }
        }
      }
    }

    return null;
  }

  static _getLowestFScore(openSet, fScore) {
    let lowestNode = null;
    let lowestScore = Infinity;

    for (const node of openSet) {
      const score = fScore.get(node) ?? Infinity;
      if (score < lowestScore) {
        lowestScore = score;
        lowestNode = node;
      }
    }
    return lowestNode;
  }

  static _reconstructPath(cameFrom, current) {
    const totalPath = [current];
    while (cameFrom.has(current)) {
      current = cameFrom.get(current);
      totalPath.unshift(current);
    }
    return totalPath;
  }
}
