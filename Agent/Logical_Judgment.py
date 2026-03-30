import os
import json
import re
from openai import OpenAI

# ================= 配置读取 =================
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
    config = json.load(f)

DEEPSEEK_API_KEY = config["API"]["DEEPSEEK_API_KEY"]
BASE_URL = config["API"]["BASE_URL"]

INPUT_FILE = config["PATHS"]["STAGE3_INPUT_FILE"]
OUTPUT_DIR = config["PATHS"]["STAGE3_OUTPUT_DIR"]

os.makedirs(OUTPUT_DIR, exist_ok=True)

# 初始化 DeepSeek 客户端
client = OpenAI(
    api_key=DEEPSEEK_API_KEY,
    base_url=BASE_URL
)

# ================= 提示词区域 =================
PROMPT = """检查事件中的人物是否存在为同一人的情况，如果为同一人，则选择更加具体的、且一致的称呼。同时检查是否存在相同的时间但是被分成了不同的事件，视情况进行逻辑合并。
需要考察事件之间的逻辑性,当某一个群体里面所有人都已经拥有了一个单独的个体时，就不要再出现这个群体的事件了，需要通过计算相关的人物数量来判定。

必须严格按照以下JSON结构输出，不得添加任何额外说明或标记（也不要使用markdown的 ```json 标签包裹）：
{
  "案件事件三元组": [
    {
      "人物A名称": "","人物A所扮演角色": "",
      "人物B名称": "","人物B所扮演角色": "",
      "行为序列": [
        "",
        "",
        ""
      ]
    }
  ]
}
"""

def main():
    if not os.path.exists(INPUT_FILE):
        print(f"❌ 找不到输入文件: {INPUT_FILE}，请确认上一阶段已成功生成。")
        return

    print("📂 正在读取合并后的 JSON 数据...")
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
        except Exception as e:
            print(f"❌ 读取或解析输入文件失败: {e}")
            return

    data_str = json.dumps(data, ensure_ascii=False, indent=2)
    user_content = f"{PROMPT}\n具体口供内容为：\n{data_str}\n以上为全部内容。"

    print("🧠 正在调用 DeepSeek-Reasoner (思考模式) 进行逻辑判断，这可能需要一些时间，请稍候...")

    try:
        response = client.chat.completions.create(
            model="deepseek-reasoner",
            messages=[
                {"role": "user", "content": user_content}
            ],
            max_tokens=20000
        )

        result_str = response.choices[0].message.content

        cleaned_str = re.sub(r"^```json\s*", "", result_str, flags=re.MULTILINE)
        cleaned_str = re.sub(r"```\s*$", "", cleaned_str, flags=re.MULTILINE)
        cleaned_str = cleaned_str.strip()

        parsed_json = json.loads(cleaned_str)

        final_filepath = os.path.join(OUTPUT_DIR, "Logic_Checked_Merged.json")
        with open(final_filepath, 'w', encoding='utf-8') as f:
            json.dump(parsed_json, f, ensure_ascii=False, indent=2)

        print(f"\n✅ 逻辑判断与实体统一完成！")
        print(f"💾 最终结果已保存至: {final_filepath}")

    except json.JSONDecodeError as e:
        print(f"❌ JSON 解析错误，模型返回的格式可能不符合规范:\n【模型原始返回】:\n{result_str}\n【错误信息】: {e}")
    except Exception as e:
        print(f"❌ API 调用或处理过程发生错误: {e}")

if __name__ == "__main__":
    main()