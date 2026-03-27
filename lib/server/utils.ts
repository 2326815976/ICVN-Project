import { randomUUID } from "crypto";

import type {
  AiParseResult,
  AiRawParseResult,
  AiRawParseResponse,
  GraphEdge,
  GraphNode,
  JsonValue,
  TaskSourceType,
} from "@/lib/domain/models";

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix: string) {
  // Keep generated ids below MySQL VARCHAR(64) limits used by core tables.
  const sanitizedPrefix = prefix.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 24) || "id";
  const token = randomUUID().replace(/-/g, "").slice(0, 24);
  return `${sanitizedPrefix}_${token}`;
}

export function truncateText(value: string, length = 200) {
  return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 3))}...`;
}

export function toJsonString(value: unknown) {
  return JSON.stringify(value ?? null);
}

export function fromJsonValue<T>(value: unknown, fallback: T) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  return value as T;
}

export function coerceRecord(value: unknown) {
  const record = fromJsonValue<Record<string, JsonValue>>(value, {});
  return typeof record === "object" && record && !Array.isArray(record) ? record : {};
}

export function coerceStringArray(value: unknown) {
  const items = fromJsonValue<unknown[]>(value, []);
  return Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : [];
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return {
    items: paged,
    page,
    pageSize,
    total: items.length,
  };
}

const chineseStopWords = new Set([
  "人物",
  "关系",
  "任务",
  "图谱",
  "文档",
  "解析",
  "结果",
  "版本",
  "内容",
  "数据",
  "系统",
  "处理",
  "应用",
]);

export function extractEntityCandidates(text: string) {
  const matches = [
    ...(text.match(/\b[A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*)*\b/g) ?? []),
    ...(text.match(/[\u4e00-\u9fa5]{2,6}/g) ?? []),
  ];

  const unique = new Set<string>();

  for (const raw of matches) {
    const value = raw.trim();
    if (!value || chineseStopWords.has(value)) {
      continue;
    }

    unique.add(value);
    if (unique.size >= 6) {
      break;
    }
  }

  return [...unique];
}

export function buildSyntheticParseResult(input: {
  graphId: string;
  taskId: string;
  title: string;
  sourceType: TaskSourceType;
  content?: string;
  language?: string;
}): AiParseResult {
  const createdAt = nowIso();
  const content = input.content?.trim() ?? "";
  const summaryText = content || input.title;
  const entityLabels = extractEntityCandidates(`${input.title}\n${content}`);

  const nodes: GraphNode[] = entityLabels.map((label, index) => ({
    id: createId(`node_${input.taskId}_${index + 1}`),
    graphId: input.graphId,
    type: "person",
    label,
    properties: {
      inferredBy: "synthetic-task-parser",
      sourceType: input.sourceType,
    },
    position: {
      x: 160 + index * 220,
      y: 140,
    },
    createdAt,
    updatedAt: createdAt,
  }));

  const eventNode: GraphNode = {
    id: createId(`event_${input.taskId}`),
    graphId: input.graphId,
    type: "event",
    label: input.title,
    properties: {
      inferredBy: "synthetic-task-parser",
      preview: truncateText(summaryText, 120),
    },
    position: {
      x: 220,
      y: 340,
    },
    participants: nodes.map((node) => node.id),
    createdAt,
    updatedAt: createdAt,
  };

  const edges: GraphEdge[] = nodes.map((node, index) => ({
    id: createId(`edge_${input.taskId}_${index + 1}`),
    graphId: input.graphId,
    sourceId: node.id,
    targetId: eventNode.id,
    relation: "participated_in",
    label: "参与",
    properties: {
      inferredBy: "synthetic-task-parser",
    },
    createdAt,
    updatedAt: createdAt,
  }));

  return {
    meta: {
      sourceType: input.sourceType,
      language: input.language ?? "zh-CN",
      summary: truncateText(summaryText, 160),
    },
    nodes,
    edges,
    events: [eventNode],
  };
}

function normalizeLookupKey(value?: string | null) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function buildPersonProperties(person: {
  id?: string;
  name?: string;
  sex?: string;
  birthday?: string;
  IDnumber?: string;
  regPlace?: string;
  nowPlace?: string;
  occupation?: string;
  family?: string;
  criminal?: string;
  remark?: string;
}) {
  const properties: Record<string, JsonValue> = {};

  for (const [key, rawValue] of Object.entries(person)) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }

    const value = rawValue.trim();
    if (!value) {
      continue;
    }

    properties[key] = value;
  }

  return properties;
}

function summarizeRawResult(rawResult: AiRawParseResult) {
  const eventSummary = rawResult.events
    .map((event) => event.eventOverview?.trim() || event.eventDescription?.trim() || "")
    .filter((item) => item.length > 0)
    .join("；");

  if (eventSummary) {
    return truncateText(eventSummary, 160);
  }

  const personSummary = rawResult.interrogatedPerson
    .map((person) => person.name?.trim() || person.id?.trim() || "")
    .filter((item) => item.length > 0)
    .join("、");

  if (personSummary) {
    return truncateText(personSummary, 160);
  }

  return "AI 已返回结构化结果";
}

export function buildGraphResultFromRawAiParseResponse(input: {
  graphId: string;
  taskId: string;
  sourceType: TaskSourceType;
  rawResult: AiRawParseResponse;
}): AiParseResult {
  const createdAt = nowIso();
  const personNodes: GraphNode[] = [];
  const eventNodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const personKeyToId = new Map<string, string>();
  const personNameToId = new Map<string, string>();
  const rawResult = input.rawResult.result;

  const registerPersonNode = (params: {
    preferredId?: string;
    name?: string;
    type?: string;
    properties?: Record<string, JsonValue>;
  }) => {
    const rawName = params.name?.trim() ?? "";
    const label = rawName || params.preferredId?.trim() || "未命名人物";
    const nodeId = params.preferredId?.trim() || createId(`person_${input.taskId}`);
    const keyCandidates = [normalizeLookupKey(rawName), normalizeLookupKey(nodeId)].filter(Boolean);

    for (const key of keyCandidates) {
      const existingId = personKeyToId.get(key);
      if (existingId) {
        if (rawName) {
          personNameToId.set(normalizeLookupKey(rawName), existingId);
        }

        return existingId;
      }
    }

    const node: GraphNode = {
      id: nodeId,
      graphId: input.graphId,
      type: "person",
      label,
      properties: {
        inferredBy: "ai-raw-result",
        sourceType: input.sourceType,
        sourceRole: params.type ?? "person",
        ...(params.properties ?? {}),
      },
      createdAt,
      updatedAt: createdAt,
    };

    personNodes.push(node);

    for (const key of keyCandidates) {
      personKeyToId.set(key, node.id);
    }

    if (rawName) {
      personNameToId.set(normalizeLookupKey(rawName), node.id);
    }

    return node.id;
  };

  for (const person of rawResult.interrogatedPerson) {
    registerPersonNode({
      preferredId: person.id,
      name: person.name,
      type: "interrogatedPerson",
      properties: buildPersonProperties(person),
    });
  }

  for (const person of rawResult.eventPerson) {
    if (!person.name?.trim()) {
      continue;
    }

    registerPersonNode({
      name: person.name,
      type: "eventPerson",
      properties: {
        name: person.name.trim(),
      },
    });
  }

  rawResult.events.forEach((event, index) => {
    const label =
      event.eventOverview?.trim() ||
      event.eventDescription?.trim() ||
      event.eventID?.trim() ||
      `事件 ${index + 1}`;
    const eventId = event.eventID?.trim() || createId(`event_${input.taskId}_${index + 1}`);
    const eventNode: GraphNode = {
      id: eventId,
      graphId: input.graphId,
      type: "event",
      label,
      properties: {
        inferredBy: "ai-raw-result",
        sourceType: input.sourceType,
        eventID: event.eventID?.trim() || eventId,
        eventDescription: event.eventDescription?.trim() || "",
        eventOverview: event.eventOverview?.trim() || "",
        name1: event.name1?.trim() || "",
        name2: event.name2?.trim() || "",
      },
      position: {
        x: 240 + index * 260,
        y: 360,
      },
      createdAt,
      updatedAt: createdAt,
    };

    eventNodes.push(eventNode);

    for (const participantName of [event.name1, event.name2]) {
      const normalizedName = normalizeLookupKey(participantName);
      if (!normalizedName) {
        continue;
      }

      const participantId =
        personNameToId.get(normalizedName) ||
        registerPersonNode({
          name: participantName,
          type: "eventParticipant",
          properties: {
            name: participantName?.trim() || "",
          },
        });

      edges.push({
        id: createId(`edge_${input.taskId}_${eventNode.id}_${participantId}`),
        graphId: input.graphId,
        sourceId: participantId,
        targetId: eventNode.id,
        relation: "participated_in",
        label: "参与",
        properties: {
          inferredBy: "ai-raw-result",
          sourceType: input.sourceType,
        },
        createdAt,
        updatedAt: createdAt,
      });
    }
  });

  personNodes.forEach((node, index) => {
    node.position = {
      x: 120 + (index % 4) * 220,
      y: 120 + Math.floor(index / 4) * 120,
    };
  });

  eventNodes.forEach((node) => {
    node.participants = edges
      .filter((edge) => edge.targetId === node.id)
      .map((edge) => edge.sourceId);
  });

  return {
    meta: {
      sourceType: input.sourceType,
      language: "zh-CN",
      summary: summarizeRawResult(rawResult),
      provider: rawResult.meta.provider,
      model: rawResult.meta.model,
    },
    nodes: personNodes,
    edges,
    events: eventNodes,
  };
}

export function buildSyntheticRawAiParseResponse(input: {
  taskId: string;
  title: string;
  content?: string;
}): AiRawParseResponse {
  return {
    taskId: input.taskId,
    type: "merge",
    result: {
      meta: {
        provider: "default",
        model: "deepseek",
      },
      interrogatedPerson: [
        {
          id: "person_1",
          name: "高某某",
          sex: "男",
          birthday: "1982年**月**日",
          IDnumber: "3723011982********",
          regPlace: "山东省滨州市滨城区里",
          nowPlace: "广西南宁市西乡塘区安吉大道",
          occupation: "打零工",
          family: "妻子：蒙金某，43岁；大女儿：高裕某，11岁；小女儿：高裕某，9岁",
          criminal: "多年前在山东被公安机关治安处罚过一次，具体事项不详",
          remark: "运送他人偷渡，驾驶员",
        },
        {
          id: "person_2",
          name: "朱明某",
          sex: "男",
          birthday: "1994年10月18日",
          IDnumber: "4505121994********",
          regPlace: "广西北海市兴港镇",
          nowPlace: "广西北海市兴港镇",
          occupation: "无业",
          family: "父亲：朱光某，54岁；母亲：梁娟某，54岁；妹妹：朱明某，28岁",
          criminal: "无",
          remark: "偷渡人员，目的地越南",
        },
        {
          id: "person_3",
          name: "方升某",
          sex: "男",
          birthday: "2004年**月**日",
          IDnumber: "5306272004********",
          regPlace: "云南省昭通市镇雄县盐源镇",
          nowPlace: "云南省昭通市镇雄县盐源镇",
          occupation: "无固定职业（服务员等）",
          family: "父亲：方先某，40岁左右；母亲：文朝某，40岁左右",
          criminal: "无",
          remark: "偷渡人员，目的地新加坡，从事洗钱",
        },
        {
          id: "person_4",
          name: "丁传某",
          sex: "男",
          birthday: "1994年**月**日",
          IDnumber: "3426231994********",
          regPlace: "安徽省芜湖市无为市泉塘镇",
          nowPlace: "安徽省芜湖市无为市泉塘镇",
          occupation: "无固定职业",
          family: "父亲：丁仁某，70岁；母亲：范桂某，67岁",
          criminal: "2024年6月在菲律宾因涉嫌诈骗被遣返，后被上海嘉定公安局取保候审",
          remark: "偷渡人员，目的地柬埔寨，从事六合彩工作",
        },
        {
          id: "person_5",
          name: "梁靖某",
          sex: "男",
          birthday: "2006年**月**日",
          IDnumber: "5224242006********",
          regPlace: "贵州省毕节市金沙县后山镇",
          nowPlace: "贵州省毕节市金沙县后山镇",
          occupation: "无固定职业",
          family: "父亲：梁彬某，38岁；母亲：罗思某，38岁",
          criminal: "无",
          remark: "偷渡人员，目的地柬埔寨，从事电诈",
        },
        {
          id: "person_6",
          name: "罗某",
          sex: "男",
          birthday: "2005年**月**日",
          IDnumber: "5101312005********",
          regPlace: "四川省浦江县寿安街道",
          nowPlace: "四川省浦江县寿安街道围镇",
          occupation: "无业",
          family: "父亲：罗江某，45岁；母亲：李燕某，45岁",
          criminal: "2024年因出借银行卡被成都市浦江县人民法院判处有期徒刑6个月，缓刑1年，2025年6月5日缓刑结束",
          remark: "偷渡人员，目的地柬埔寨，从事电诈",
        },
        {
          id: "person_7",
          name: "黄某",
          sex: "男",
          birthday: "2001年**月**日",
          IDnumber: "5224242001********",
          regPlace: "贵州省金沙县后山镇",
          nowPlace: "贵州省金沙县后山镇",
          occupation: "无业",
          family: "父亲：黄朝某，60岁；母亲：汪章某，47岁",
          criminal: "无",
          remark: "偷渡人员，目的地柬埔寨，从事电诈",
        },
        {
          id: "person_8",
          name: "魏某",
          sex: "男",
          birthday: "1998年**月**日",
          IDnumber: "3204821998********",
          regPlace: "江苏省常州市金坛区儒林镇",
          nowPlace: "江苏省常州市金坛区儒林镇",
          occupation: "无业",
          family: "父亲：魏泉某，53岁；母亲：周云某，51岁",
          criminal: "无",
          remark: "偷渡人员，目的地不明，声称从事走私香烟",
        },
      ],
      eventPerson: [
        { name: "高某某" },
        { name: "朱明某" },
        { name: "方升某" },
        { name: "丁传某" },
        { name: "梁靖某" },
        { name: "罗某" },
        { name: "黄某" },
        { name: "魏某" },
        { name: "D钓鱼老板" },
        { name: "阿伦" },
        { name: "阿明" },
        { name: "大师兄" },
        { name: "黄涛" },
        { name: "田德某" },
        { name: "江琴芳" },
      ],
      events: [
        {
          eventID: "event_1",
          name1: "高某某",
          name2: "D钓鱼老板",
          eventDescription:
            "高某某受‘D钓鱼老板’指使，于2025年11月7日晚驾驶一辆无牌黑色比亚迪SUV，在广西合浦县搭载朱明某、方升某、丁传某、梁靖某、罗某、黄某、魏某等7名欲偷渡出境人员，前往钦州港三墩码头，途中被公安机关查获。高某某收取1000元报酬，明知运送人员偷渡仍实施该行为。",
          eventOverview: "运送他人偷渡",
        },
        {
          eventID: "event_2",
          name1: "朱明某",
          name2: "阿伦",
          eventDescription:
            "朱明某受‘阿伦’安排，于2025年11月7日晚在合浦县昌和大酒店附近，乘坐高某某驾驶的车辆欲偷渡至越南，在途中被查获。朱明某清楚偷渡目的，且有境外工作意向。",
          eventOverview: "偷渡出境（越南）",
        },
        {
          eventID: "event_3",
          name1: "方升某",
          name2: "上家（钉钉联系人）",
          eventDescription:
            "方升某通过网络联系境外上家，欲偷渡至新加坡从事洗钱活动，上家为其购买车票并安排接应。2025年11月7日晚，方升某在合浦县乘坐高某某车辆前往偷渡点途中被查获。",
          eventOverview: "偷渡出境（新加坡）",
        },
        {
          eventID: "event_4",
          name1: "丁传某",
          name2: "阿明",
          eventDescription:
            "丁传某受‘阿明’招募，欲偷渡至柬埔寨从事六合彩赌博相关工作。2025年11月7日晚，丁传某在合浦县某酒店门口乘坐高某某车辆，前往偷渡点途中被查获。",
          eventOverview: "偷渡出境（柬埔寨）",
        },
        {
          eventID: "event_5",
          name1: "梁靖某",
          name2: "黄某",
          eventDescription:
            "梁靖某与黄某结伙，通过网络联系境外上家，欲偷渡至柬埔寨从事电信诈骗。2025年11月7日，二人由田德某驾车送至合浦县，后乘坐高某某车辆前往偷渡点途中被查获。",
          eventOverview: "结伙偷渡出境（柬埔寨）",
        },
        {
          eventID: "event_6",
          name1: "罗某",
          name2: "大师兄",
          eventDescription:
            "罗某受境外‘大师兄’招募，欲偷渡至柬埔寨从事电信诈骗。2025年11月7日晚，罗某在合浦县昌和大酒店乘坐高某某车辆前往偷渡点途中被查获。",
          eventOverview: "偷渡出境（柬埔寨）",
        },
        {
          eventID: "event_7",
          name1: "魏某",
          name2: "上家（QQ联系人）",
          eventDescription:
            "魏某通过网络联系上家，欲偷渡出境从事走私香烟活动。2025年11月7日晚，魏某在合浦县乘坐高某某车辆前往偷渡点途中被查获。",
          eventOverview: "偷渡出境",
        },
        {
          eventID: "event_8",
          name1: "田德某",
          name2: "江琴芳",
          eventDescription:
            "田德某与江琴芳受梁靖某、黄某欺骗，驾车将二人从贵州金沙县送至广西北海市，以为二人系前往游玩，对二人偷渡计划不知情。",
          eventOverview: "被利用运送偷渡人员",
        },
      ],
    },
    errorMessage: null,
    createdAt: "2026-03-27T00:00:00.000Z",
    updatedAt: "2026-03-27T00:00:00.000Z",
  };
}
