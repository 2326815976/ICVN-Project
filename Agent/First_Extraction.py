import os
import json
from openai import OpenAI

# ================= 配置读取 =================
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
    config = json.load(f)

DEEPSEEK_API_KEY = config["API"]["DEEPSEEK_API_KEY"]
BASE_URL = config["API"]["BASE_URL"]

INPUT_JSON_FILE = config["PATHS"]["STAGE1_INPUT_FILE"]
OUTPUT_DIR = config["PATHS"]["STAGE1_OUTPUT_DIR"]

# 确保输出目录存在
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 初始化 DeepSeek 客户端
client = OpenAI(
    api_key=DEEPSEEK_API_KEY,
    base_url=BASE_URL
)

# ================= 提示词区域 =================
SYSTEM_PROMPT = """请将后面的口供内容进行整理，按照json模板提取出个人信息与案件相关的人物交互信息，注意前后的逻辑关系。在描述事件的时候，需要加上里面所提到的姓名（名称），即谁对谁做了什么，如果完全无法找到相关信息就填写NULL，同时，请注意部分输出格式有特别要求：
1.如果年龄是准确地在笔录中出现，必须是准确的数值，不能输出任何额外的内容，包括字符。如果是出现“大约XX岁”的文本，则严格输出“大约XX”，如果是“XX岁到XX岁”之类的文本，则严格输出“XX-XX”；
2.涉案工具必须严格输出一个确定的形容词+名词；
3.联系方式优先填写电话号码，格式严格写为“手机:XXX”，其次是QQ号，格式严格为“QQ号:XXX“和微信号,格式严格为：”微信号:XXX”，再其次是QQ昵称格式严格为“QQ昵称:XXX“和微信昵称,格式严格为”微信昵称:XXX”，否则填写NULL；
4.请注意，里面的人对同一个人的称呼可能会不同，需要分辨出来，然后进行合并，同一个人只能有一个个体；
5.尽可能详尽地还原口供中的案件经过，绝对不能进行过度概括或省略细节。相同的时间即使存在不同的步骤也为行为序列的同一行。数组的长度没有限制。描述时必须具体。
6.确保所有的案件事件三元组出现的人物A与人物B，除了被审讯人之外的人物都在案件参与人列表里；同样的，案件参与人列表里出现的人物都需要是案件事件三元组出现的人物A或人物B；
事件以时间先后顺序排列，事件的描述以时间开头。不要输出除了模板以外的额外信息，或者任何markdown标记。

{
  "被审讯人": {
    "姓名": "",
    "性别": "",
    "年龄": "",
    "出生日期": "",
    "身份证号": "",
    "户籍地": "",
    "现住址": "",
    "联系方式": "",
    "职业/社会身份": "",
    "家庭成员": "",
    "既往违法犯罪记录": "",
    "其他补充": ""
  },
  "案件参与人": [
    {
      "称呼": "",
      "扮演角色": "",
      "联系方式": "",
      "户籍": "",
      "年龄": "",
      "涉案工具": "",
      "核心涉案行为": "",
      "备注": ""
    }
  ],
  "案件事件三元组": [
    {
      "人物A": {
        "名称": "",
        "所扮演角色": "",
        "涉案工具": ""
      },
      "人物B": {
        "名称": "",
        "所扮演角色": "",
        "涉案工具": ""
      },
      "行为序列": [
        "", 
        "", 
        ""
      ]
    }
  ]
}
以上是需要严格回复的json模板，具体的口供内容为：
"""

def process_content(text_content, index, task_id):
    """处理单条文本内容并调用大模型"""
    print(f"正在处理 Task: {task_id} 的第 {index + 1} 份内容 ...")

    text_content = text_content.strip()
    if not text_content:
        print(f"警告: 第 {index + 1} 份内容为空，已跳过。")
        return

    user_content = SYSTEM_PROMPT + "\n" + text_content

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system",
                 "content": "你是一个严谨的法务数据提取助手。你必须严格按照提供的 JSON 格式输出，不要包含任何 markdown 代码块（如 ```json）。"},
                {"role": "user", "content": user_content}
            ],
            response_format={"type": "json_object"},
            temperature=0.1
        )

        result_str = response.choices[0].message.content

        try:
            parsed_json = json.loads(result_str)
        except json.JSONDecodeError:
            print(f"错误: 第 {index + 1} 份内容返回的不是标准 JSON 格式。返回内容:\n{result_str}")
            return

        suspect_name = parsed_json.get("被审讯人", {}).get("姓名", "未知姓名").strip()
        if not suspect_name or suspect_name == "NULL":
            suspect_name = f"未知姓名_{task_id}_部分{index + 1}"

        output_filepath = os.path.join(OUTPUT_DIR, f"{suspect_name}.json")
        with open(output_filepath, 'w', encoding='utf-8') as f:
            json.dump(parsed_json, f, ensure_ascii=False, indent=2)

        print(f"成功: 第 {index + 1} 份内容 -> 已保存为 {suspect_name}.json")

    except Exception as e:
        print(f"API 请求或处理过程发生错误 (第 {index + 1} 份内容): {e}")


def main():
    if not os.path.exists(INPUT_JSON_FILE):
        print(f"错误: 未找到输入文件 {INPUT_JSON_FILE}")
        return

    try:
        with open(INPUT_JSON_FILE, 'r', encoding='utf-8') as f:
            input_data = json.load(f)
    except Exception as e:
        print(f"读取文件时发生错误: {e}")
        return

    task_id = input_data.get("taskId", "unknown_task")
    content_list = input_data.get("content", [])

    if not isinstance(content_list, list) or not content_list:
        print(f"警告: 任务 {task_id} 中没有找到 content 列表或列表为空。")
        return

    print(f"任务 {task_id} 共读取到 {len(content_list)} 份文本内容，开始提取...")

    for index, text_content in enumerate(content_list):
        process_content(text_content, index, task_id)

    print("所有内容处理完毕！")

if __name__ == "__main__":
    main()