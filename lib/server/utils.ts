import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";

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
    const rawEventId = event.eventID?.trim();
    const eventId = rawEventId
      ? createId(`event_${input.taskId}_${rawEventId}`)
      : createId(`event_${input.taskId}_${index + 1}`);
    const eventNode: GraphNode = {
      id: eventId,
      graphId: input.graphId,
      type: "event",
      label,
      properties: {
        inferredBy: "ai-raw-result",
        sourceType: input.sourceType,
        eventID: rawEventId || eventId,
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
  const fixedTimestamp = "2026-03-29T11:39:07.000Z";

  const interrogatedPerson = [
    {
      id: "1",
      name: "丁传某",
      sex: "男",
      birthday: "1994年**月**日",
      IDnumber: "3426231994********",
      regPlace: "安徽省芜湖市无为市泉塘镇",
      nowPlace: "安徽省芜湖市无为市泉塘镇",
      occupation: "无固定职业",
      family: "父亲:丁仁某,70岁,在家务农;母亲:范桂某,67岁,在家务农",
      criminal: "2024年6月份,在菲律宾因涉嫌诈骗被遣返回到中国,之后被上海嘉定公安局取保候审",
      remark: "QQ昵称:钱难*",
    },
    {
      id: "2",
      name: "方升某",
      sex: "男",
      birthday: "2004-**-**",
      IDnumber: "5306272004********",
      regPlace: "云南省昭通市镇雄县盐源镇",
      nowPlace: "云南省昭通市镇雄县盐源镇",
      occupation: "高中肄业，曾做服务员、工地工作",
      family: "父亲:方先某,40岁左右,在老家;母亲:文朝某,40岁左右,在杭州务工",
      criminal: "没有",
      remark: "抖音号:unfruitful*****,昵称:unfruitfu*****;QQ昵称:晚秋;微信昵称:.",
    },
    {
      id: "3",
      name: "朱明某",
      sex: "男",
      birthday: "1994年10月18日",
      IDnumber: "45051219941*****",
      regPlace: "广西北海市兴港镇",
      nowPlace: "广西北海市兴港镇",
      occupation: "无业",
      family: "父亲:朱光某,年龄:54岁,职业:无业;母亲:梁娟某,年龄:54岁,职业:无业,联系方式:手机:137077*****;妹妹:朱明某,年龄:28岁,职业:北海市海城区**小学教书",
      criminal: "无",
      remark: "未婚,初中文化程度,护照号码:EE26****",
    },
    {
      id: "4",
      name: "梁靖某",
      sex: "男",
      birthday: "2006年**月**日",
      IDnumber: "5224242006******",
      regPlace: "贵州省毕节市金沙县后山镇",
      nowPlace: "贵州省毕节市金沙县后山镇",
      occupation: "初中文化程度，曾打工",
      family: "父亲:梁彬某,38岁,在老家工作;母亲:罗思某,38岁,现在在老家",
      criminal: "没有",
      remark: "涉嫌偷渡到柬埔寨从事电诈工作",
    },
    {
      id: "5",
      name: "罗某",
      sex: "男",
      birthday: "2005年**月**日",
      IDnumber: "5101312005********",
      regPlace: "四川省浦江县寿安街道",
      nowPlace: "四川省浦江县寿安街道围镇",
      occupation: "无业",
      family: "父亲罗江某，45岁，在老家务工；母亲李燕某，45岁，在成都务工，电话号码是：17340****",
      criminal: "2024年因出借银行卡被成都市浦江县人民法院判处有期徒刑6个月，缓刑1年，2025年6月5日缓刑结束",
      remark: "微信号：A-B-C****，微信昵称是：1；微信号是：wxid_xugca*****，微信昵称是：“”；QQ号是：3096****，QQ昵称是：陈浩南；支付宝账号：183493****，支付宝昵称是：“无”",
    },
    {
      id: "6",
      name: "高路某",
      sex: "男",
      birthday: "1982-11-11",
      IDnumber: "372301198211111111",
      regPlace: "山东省滨州市滨城市里",
      nowPlace: "广西南宁市西乡塘区安吉大道",
      occupation: "零工",
      family: "妻子:蒙金某,43岁,在南宁务工;大女儿:高裕某,11岁,在南宁**小学读书;小女儿:高裕某,9岁,在南宁**小学读书",
      criminal: "多年前在山东被公安机关治安处罚过一次",
      remark: "微信有两个,分别为微信昵称:紫气东来,微信号:wxid_pi8idzs*******;微信昵称:时来运转,微信号:wxid_5wj1m97*******",
    },
    {
      id: "7",
      name: "魏某",
      sex: "男",
      birthday: "1998年**月**日",
      IDnumber: "3204821998*******",
      regPlace: "江苏省常州市金坛区儒林镇",
      nowPlace: "江苏省常州市金坛区儒林镇",
      occupation: "无工作",
      family: "父亲:魏泉某,53岁,在家务农;母亲:周云某,51岁,在家务农",
      criminal: "无",
      remark: "中专文化程度,汉族,认罪认罚",
    },
    {
      id: "8",
      name: "黄某",
      sex: "男",
      birthday: "2001年**月**日",
      IDnumber: "5224242001********",
      regPlace: "贵州省金沙县后山镇",
      nowPlace: "贵州省金沙县后山镇",
      occupation: "无业",
      family: "父亲:黄朝某,60岁,在浙江省工作;母亲:汪章某,47岁,在浙江省工作",
      criminal: "无",
      remark: "中专文化程度,汉族",
    },
  ];

  const eventPerson = [
    { name: "152961*****" },
    { name: "自称本地人的男子" },
    { name: "顺水推舟" },
    { name: "警察" },
    { name: "阿明" },
    { name: "钉钉/QQ联系人" },
    { name: "穿黄色外套的男子" },
    { name: "D钓鱼老板" },
    { name: "中间排肥肥男子" },
    { name: "江琴芳" },
    { name: "对方" },
    { name: "阿伦" },
    { name: "大师兄" },
    { name: "田德某" },
    { name: "黄头发男子" },
    { name: "年轻男子" },
    { name: "抖音联系人" },
  ];

  const events = (() => {
    try {
      const filePath = path.join(process.cwd(), "Agent", "Last_Out", "Last_output.json");
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
        案件事件三元组?: Array<{
          人物A名称?: string;
          人物B名称?: string;
          行为序列?: string[];
          简介?: string;
        }>;
      };

      const triples = parsed.案件事件三元组 ?? [];
      return triples.map((item, index) => ({
        eventID: String(index + 1),
        name1: item.人物A名称 ?? "",
        name2: item.人物B名称 ?? "",
        eventDescription: Array.isArray(item.行为序列) ? item.行为序列.join("\n") : "",
        eventOverview: item.简介 ?? "",
      }));
    } catch {
      return [];
    }
  })();

  return {
    taskId: input.taskId,
    projectId: "我这边不提供这个，需要数据库去进行累计判断",
    type: "merge",
    result: {
      meta: {
        provider: "default",
        model: "deepseek",
      },
      interrogatedPerson,
      eventPerson,
      events,
    },
    errorMessage: "",
    createdAt: fixedTimestamp,
    updatedAt: fixedTimestamp,
  };
}
