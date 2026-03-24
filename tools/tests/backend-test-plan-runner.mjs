import fs from "fs";
import mysql from "mysql2/promise";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3001";

function loadEnvFile(path) {
  if (!fs.existsSync(path)) return;
  const text = fs.readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

const results = [];
function record(section, name, ok, detail = "") {
  results.push({ section, name, ok, detail });
  const marker = ok ? "PASS" : "FAIL";
  console.log(`[${marker}] ${section} :: ${name}${detail ? ` -> ${detail}` : ""}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function apiRequest(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let json;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  return { status: res.status, json };
}

function assertEnvelope(response, expectSuccess) {
  assert(response.json && typeof response.json === "object", "response JSON missing");
  assert(typeof response.json.success === "boolean", "success flag missing");
  assert(response.json.success === expectSuccess, `success expected ${expectSuccess}, got ${response.json.success}`);
  assert(response.json.meta && typeof response.json.meta.requestId === "string", "meta.requestId missing");
  assert(typeof response.json.meta.timestamp === "string", "meta.timestamp missing");
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/tasks?graphId=default`);
      if (res.status > 0) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server not ready at ${BASE_URL}`);
}

async function run() {
  loadEnvFile(".env.local");

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.MYSQL_PORT ?? "3306", 10),
    user: process.env.MYSQL_USER ?? "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE ?? "icvn_graph",
    timezone: "Z",
  });

  try {
    await waitForServer();

    const graphId = randomId("gtest");
    await connection.execute(
      "INSERT INTO graphs (id, name, description, status, created_by) VALUES (?, ?, ?, 'active', 'test-runner')",
      [graphId, `Graph ${graphId}`, "test graph"],
    );

    // Unit (minimal, utils only)
    {
      const section = "UNIT";
      try {
        const utils = await import("../../lib/server/utils.ts");
        assert(utils.truncateText("abc", 10) === "abc", "truncate short text failed");
        assert(utils.truncateText("abcdefgh", 5) === "ab...", "truncate long text failed");
        const pg = utils.paginate([1, 2, 3, 4, 5], 2, 2);
        assert(pg.items.length === 2 && pg.total === 5, "paginate failed");
        const rec = utils.coerceRecord('{"a":1}');
        assert(rec.a === 1, "coerceRecord failed");
        const arr = utils.coerceStringArray('["a",1,"b"]');
        assert(Array.isArray(arr) && arr.length === 2, "coerceStringArray failed");
        const parsed = utils.buildSyntheticParseResult({
          graphId,
          taskId: randomId("task"),
          title: "张三 与 李四 参加会议",
          sourceType: "text",
          content: "张三和李四在北京出席活动",
          language: "zh-CN",
        });
        assert(parsed.nodes.length >= 1 && parsed.edges.length >= 1 && parsed.events.length >= 1, "synthetic parse failed");
        record(section, "utils functions", true);
      } catch (error) {
        record(section, "utils functions", false, error.message);
      }
    }

    // API + Integration fixtures
    let nodeA;
    let nodeB;
    let edgeAB;
    let createdTask;
    let createdVersion;

    {
      const section = "API_CONTRACT";
      try {
        const createNodeA = await apiRequest("POST", "/api/graph/nodes", {
          graphId,
          type: "person",
          label: "Alice",
          properties: { role: "tester" },
        });
        assert(createNodeA.status === 201, `createNodeA status ${createNodeA.status}`);
        assertEnvelope(createNodeA, true);
        nodeA = createNodeA.json.data;

        const createNodeB = await apiRequest("POST", "/api/graph/nodes", {
          graphId,
          type: "person",
          label: "Bob",
          properties: { role: "reviewer" },
        });
        assert(createNodeB.status === 201, `createNodeB status ${createNodeB.status}`);
        assertEnvelope(createNodeB, true);
        nodeB = createNodeB.json.data;

        const createEdge = await apiRequest("POST", "/api/graph/edges", {
          graphId,
          sourceId: nodeA.id,
          targetId: nodeB.id,
          relation: "knows",
          properties: { confidence: 0.9 },
        });
        assert(createEdge.status === 201, `createEdge status ${createEdge.status}`);
        assertEnvelope(createEdge, true);
        edgeAB = createEdge.json.data;

        const createTask = await apiRequest("POST", "/api/tasks", {
          graphId,
          sourceType: "text",
          title: "测试任务",
          content: "张三和李四参加活动。",
        });
        assert(createTask.status === 201, `createTask status ${createTask.status}`);
        assertEnvelope(createTask, true);
        createdTask = createTask.json.data;

        const endpoints = [
          ["GET", `/api/tasks?graphId=${graphId}`, 200],
          ["GET", `/api/tasks/${createdTask.id}`, 200],
          ["GET", `/api/tasks/${createdTask.id}/result`, 200],
          ["POST", `/api/tasks/${createdTask.id}/apply`, 200, { graphId, createSnapshot: true }],
          ["GET", `/api/tasks/${createdTask.id}/events`, 200],
          ["PATCH", `/api/graph/nodes/${nodeA.id}`, 200, { label: "Alice Updated" }],
          ["PATCH", `/api/graph/edges/${edgeAB.id}`, 200, { relation: "colleague" }],
          ["GET", `/api/graph/view?graphId=${graphId}`, 200],
          ["GET", `/api/graph/subgraph?graphId=${graphId}&rootId=${nodeA.id}&depth=2`, 200],
          ["GET", `/api/query/nodes/${nodeA.id}/relations?graphId=${graphId}`, 200],
          ["GET", `/api/query/nodes/${nodeA.id}/detail?graphId=${graphId}`, 200],
          ["GET", `/api/query/nodes/${nodeA.id}/sources?graphId=${graphId}`, 200],
          ["GET", `/api/query/nodes/${nodeA.id}/history?graphId=${graphId}`, 200],
          ["GET", `/api/query/edges/${edgeAB.id}?graphId=${graphId}`, 200],
          ["GET", `/api/query/search?graphId=${graphId}&keyword=Alice`, 200],
          ["GET", `/api/query/path?graphId=${graphId}&sourceId=${nodeA.id}&targetId=${nodeB.id}&maxDepth=4`, 200],
          ["POST", `/api/query/subgraph`, 200, { graphId, rootIds: [nodeA.id], depth: 2 }],
          ["POST", `/api/versions`, 201, { graphId, name: "v-test", trigger: "manual", description: "test version" }],
          ["GET", `/api/versions?graphId=${graphId}`, 200],
        ];

        const endpointFailures = [];
        for (const [method, path, status, body] of endpoints) {
          const response = await apiRequest(method, path, body);
          try {
            assert(response.status === status, `${method} ${path} expected ${status}, got ${response.status}`);
            assertEnvelope(response, status < 400);
          } catch (error) {
            endpointFailures.push(`${method} ${path}: ${error.message}`);
          }
        }

        const versionsRes = await apiRequest("GET", `/api/versions?graphId=${graphId}`);
        createdVersion = versionsRes.json?.data?.items?.[0];
        if (!createdVersion?.id) {
          endpointFailures.push("GET /api/versions?graphId=<graphId>: no version found for detail/rollback tests");
        } else {
          const getVersionDetail = await apiRequest("GET", `/api/versions/${createdVersion.id}`);
          try {
            assert(getVersionDetail.status === 200, `get version detail status ${getVersionDetail.status}`);
            assertEnvelope(getVersionDetail, true);
          } catch (error) {
            endpointFailures.push(`GET /api/versions/{versionId}: ${error.message}`);
          }

          const rollback = await apiRequest("POST", `/api/versions/${createdVersion.id}/rollback`, {
            graphId,
            reason: "test rollback",
          });
          try {
            assert(rollback.status === 200, `rollback status ${rollback.status}`);
            assertEnvelope(rollback, true);
          } catch (error) {
            endpointFailures.push(`POST /api/versions/{versionId}/rollback: ${error.message}`);
          }
        }

        const deleteEdge = await apiRequest("DELETE", `/api/graph/edges/${edgeAB.id}?graphId=${graphId}`);
        assert(deleteEdge.status === 200, `delete edge status ${deleteEdge.status}`);
        assertEnvelope(deleteEdge, true);

        const deleteNodeA = await apiRequest("DELETE", `/api/graph/nodes/${nodeA.id}?graphId=${graphId}`);
        assert(deleteNodeA.status === 200, `delete nodeA status ${deleteNodeA.status}`);
        assertEnvelope(deleteNodeA, true);

        const deleteNodeB = await apiRequest("DELETE", `/api/graph/nodes/${nodeB.id}?graphId=${graphId}`);
        assert(deleteNodeB.status === 200, `delete nodeB status ${deleteNodeB.status}`);
        assertEnvelope(deleteNodeB, true);

        const aiCreate = await apiRequest("POST", "/api/ai/parse", {
          graphId,
          sourceType: "news",
          content: "A 与 B 达成合作。",
        });
        try {
          assert(aiCreate.status === 202, `POST /api/ai/parse expected 202, got ${aiCreate.status}`);
          assertEnvelope(aiCreate, true);
        } catch (error) {
          endpointFailures.push(`POST /api/ai/parse: ${error.message}`);
        }

        const aiJobId = aiCreate.json?.data?.jobId;
        if (!aiJobId) {
          endpointFailures.push("POST /api/ai/parse: missing data.jobId");
        } else {
          const aiGet = await apiRequest("GET", `/api/ai/jobs/${aiJobId}`);
          try {
            assert(aiGet.status === 200, `GET /api/ai/jobs/{jobId} expected 200, got ${aiGet.status}`);
            assertEnvelope(aiGet, true);
          } catch (error) {
            endpointFailures.push(`GET /api/ai/jobs/{jobId}: ${error.message}`);
          }

          const aiAttach = await apiRequest("POST", `/api/ai/jobs/${aiJobId}/apply`);
          try {
            assert(aiAttach.status === 409, `POST /api/ai/jobs/{jobId}/apply expected 409, got ${aiAttach.status}`);
            assertEnvelope(aiAttach, false);
          } catch (error) {
            endpointFailures.push(`POST /api/ai/jobs/{jobId}/apply: ${error.message}`);
          }
        }

        if (endpointFailures.length > 0) {
          throw new Error(endpointFailures.join(" | "));
        }

        record(section, "OpenAPI 29 endpoints reachable + envelope", true);
      } catch (error) {
        record(section, "OpenAPI 29 endpoints reachable + envelope", false, error.message);
      }
    }

    // Integration checks via DB assertions (repository behavior)
    {
      const section = "INTEGRATION_REPOSITORY";
      try {
        assert(createdTask?.id, "task fixture missing");

        const [[taskRow]] = await connection.execute("SELECT status, applied_version_id FROM tasks WHERE id = ?", [createdTask.id]);
        assert(taskRow, "task row missing");
        assert(taskRow.status === "applied", `task status expected applied, got ${taskRow.status}`);

        const [[resultRow]] = await connection.execute("SELECT task_id, node_count, edge_count, event_count FROM task_results WHERE task_id = ?", [createdTask.id]);
        assert(resultRow && Number(resultRow.node_count) >= 1, "task result row invalid");

        const [eventRows] = await connection.execute("SELECT event_type FROM task_events WHERE task_id = ? ORDER BY seq ASC", [createdTask.id]);
        const eventTypes = eventRows.map((row) => row.event_type);
        assert(eventTypes.includes("uploaded") && eventTypes.includes("applied"), "task event chain incomplete");

        const [historyRows] = await connection.execute("SELECT id FROM graph_change_history WHERE graph_id = ? LIMIT 1", [taskRow.graph_id ?? createdTask.graphId]);
        assert(historyRows.length > 0, "graph change history missing");

        const beforeApplyEvents = eventTypes.filter((e) => e === "applied").length;
        const applyAgain = await apiRequest("POST", `/api/tasks/${createdTask.id}/apply`, { graphId: createdTask.graphId, createSnapshot: true });
        assert(applyAgain.status === 200, `re-apply status ${applyAgain.status}`);

        const [eventRowsAfter] = await connection.execute("SELECT event_type FROM task_events WHERE task_id = ? ORDER BY seq ASC", [createdTask.id]);
        const afterApplyEvents = eventRowsAfter.filter((row) => row.event_type === "applied").length;
        assert(afterApplyEvents === beforeApplyEvents, "idempotent apply should not create extra applied events");

        record(section, "task transactional writes + idempotent apply", true);
      } catch (error) {
        record(section, "task transactional writes + idempotent apply", false, error.message);
      }
    }

    // E2E main flows
    {
      const section = "E2E_MAIN_FLOW";
      try {
        const flowGraph = randomId("gflow");
        await connection.execute(
          "INSERT INTO graphs (id, name, description, status, created_by) VALUES (?, ?, ?, 'active', 'test-runner')",
          [flowGraph, `Graph ${flowGraph}`, "flow graph"],
        );

        const createTask = await apiRequest("POST", "/api/tasks", {
          graphId: flowGraph,
          sourceType: "text",
          title: "E2E Flow",
          content: "王五和赵六共同参与项目。",
        });
        assert(createTask.status === 201, "e2e create task failed");
        const taskId = createTask.json.data.id;

        const result = await apiRequest("GET", `/api/tasks/${taskId}/result`);
        assert(result.status === 200, "e2e get result failed");

        const apply = await apiRequest("POST", `/api/tasks/${taskId}/apply`, { graphId: flowGraph, createSnapshot: true });
        assert(apply.status === 200, "e2e apply failed");

        const view = await apiRequest("GET", `/api/graph/view?graphId=${flowGraph}`);
        assert(view.status === 200, "e2e graph view failed");
        assert((view.json.data.nodes ?? []).length >= 1, "e2e graph nodes not created");

        const versions = await apiRequest("GET", `/api/versions?graphId=${flowGraph}`);
        assert(versions.status === 200 && versions.json.data.items.length >= 1, "e2e versions missing");
        const versionId = versions.json.data.items[0].id;

        const rollback = await apiRequest("POST", `/api/versions/${versionId}/rollback`, { graphId: flowGraph, reason: "e2e" });
        assert(rollback.status === 200, "e2e rollback failed");

        record(section, "task apply and version rollback closed loop", true);
      } catch (error) {
        record(section, "task apply and version rollback closed loop", false, error.message);
      }
    }

    // API error checks (part of contract)
    {
      const section = "API_ERROR_CASES";
      try {
        const badTasks = await apiRequest("GET", "/api/tasks");
        assert(badTasks.status === 400, `expected 400, got ${badTasks.status}`);
        assertEnvelope(badTasks, false);

        const badSearch = await apiRequest("GET", "/api/query/search?graphId=default");
        assert(badSearch.status === 400, `expected 400, got ${badSearch.status}`);
        assertEnvelope(badSearch, false);

        const missingTask = await apiRequest("GET", `/api/tasks/${randomId("missing")}`);
        assert(missingTask.status === 404, `expected 404, got ${missingTask.status}`);
        assertEnvelope(missingTask, false);

        const missingAiJob = await apiRequest("GET", `/api/ai/jobs/${randomId("missing_job")}`);
        assert(missingAiJob.status === 404, `expected 404, got ${missingAiJob.status}`);
        assertEnvelope(missingAiJob, false);

        record(section, "400/404/409 envelopes", true);
      } catch (error) {
        record(section, "400/404/409 envelopes", false, error.message);
      }
    }
  } finally {
    await connection.end();
  }

  const summary = results.reduce(
    (acc, cur) => {
      acc.total += 1;
      if (cur.ok) acc.passed += 1;
      else acc.failed += 1;
      return acc;
    },
    { total: 0, passed: 0, failed: 0 },
  );

  console.log("\n=== TEST SUMMARY ===");
  console.log(`Total: ${summary.total}`);
  console.log(`Passed: ${summary.passed}`);
  console.log(`Failed: ${summary.failed}`);

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Fatal test runner error:", error);
  process.exitCode = 1;
});
