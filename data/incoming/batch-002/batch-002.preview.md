# batch-002｜第二批泛读预览

实际读取摘要，所有结论限于作者报告范围。不是热点排名，也不是已完成人工核读。

## ToolTree: Efficient LLM Tool Planning via Dual-Feedback Monte Carlo Tree Search and Bidirectional Pruning

调用下一件工具之前，先考虑后续步骤和工具之间的依赖。

- ID：iclr-2026-3428db291b383208dce69ed572f2b437
- 问题：Q01；轨道：main
- 来源：https://proceedings.iclr.cc/paper_files/paper/2026/hash/3428db291b383208dce69ed572f2b437-Abstract-Conference.html
- 选取理由：补充Q01的搜索式规划路线，与首批OctoTools的工具角色组织进行对比；不按展示形式选择。

**问题**：只根据当前一步挑工具，可能忽视后续需求和工具之间的依赖；任务越长，局部合理的选择越可能把后面的路径堵住。

**发现**：论文报告：在开放与封闭工具集合的多项规划测试中，ToolTree改善了规划表现，并报告了效率收益；具体模型与预算公平性仍需核读实验。

**做法**：借鉴蒙特卡洛树搜索，即比较多条可能的行动路径，用两阶段语言模型评估配合双向剪枝，在工具执行前后淘汰不值得继续的分支。

## ToolACE-MT: Non-Autoregressive Generation for Agentic Multi-Turn Interaction

不逐轮模拟所有对话，先搭骨架再完善工具交互数据。

- ID：iclr-2026-065cb28127caf25d9f186f5460d7bb9c
- 问题：Q02；轨道：main
- 来源：https://proceedings.iclr.cc/paper_files/paper/2026/hash/065cb28127caf25d9f186f5460d7bb9c-Abstract-Conference.html
- 选取理由：补充工具使用的数据生产路线，区别于首批直接组织工具调用的框架；与训练类论文建立联系。

**问题**：逐轮让多个模型模拟用户与Agent，生成复杂工具对话往往很慢且成本高；仅有对话外形，还不足以保证调用和上下文连贯。

**发现**：论文报告：ToolACE-MT能更高效地构造多轮Agent对话，实验显示生成数据具有有效性和泛化收益；摘要不足以核查各项对照成本。

**做法**：先建立完整但粗略的对话骨架，再通过遮盖与补填逐步增加真实复杂性，最后用规则和模型在离线阶段检查正确性与连贯性。

图解：先搭骨架，再补全，最后检查
- 对话骨架：先生成结构完整但语义粗略的多轮对话。
- 迭代完善：通过遮盖与补填增加复杂性，继续细化对话。
- 离线验证：用规则和模型检查调用正确性及对话连贯性。

## Meta-RL Induces Exploration in Language Agents

让Agent从尝试和反馈中学会探索，而不只完成单次任务。

- ID：iclr-2026-06c6b876c4890d4d57442365d7e6d864
- 问题：Q04；轨道：main
- 来源：https://proceedings.iclr.cc/paper_files/paper/2026/hash/06c6b876c4890d4d57442365d7e6d864-Abstract-Conference.html
- 选取理由：补充Q04探索与测试时适应路线，与首批AgentBrew离线轨迹学习对照。

**问题**：普通强化学习训练的Agent仍可能不善于探索，在需要反复试错的新任务中，未必能把上一次的反馈转化成下一次的改进。

**发现**：论文报告：LaMer在推箱子、扫雷和Webshop等测试中优于强化学习基线，并在更难或未见任务上显示泛化收益；设置细节仍待核读。

**做法**：采用元强化学习，即训练如何从经验中继续学习：跨多个回合优化长期回报，再让Agent通过上下文中的反思利用任务反馈，无须在测试时更新参数。

## Don't Just Fine-tune the Agent, Tune the Environment

不只调整Agent参数，也调整它学习时遇到的环境与反馈。

- ID：iclr-2026-0b289714c468d6fdf26ea736af3d488c
- 问题：Q04；轨道：main
- 来源：https://proceedings.iclr.cc/paper_files/paper/2026/hash/0b289714c468d6fdf26ea736af3d488c-Abstract-Conference.html
- 选取理由：与LaMer形成训练思路对照：一篇强调跨回合学习探索，另一篇强调学习环境和反馈设计。

**问题**：合成数据上的监督训练可能过拟合，直接强化学习又可能起步困难、训练不稳定；缺少高质量专家轨迹进一步限制了学习。

**发现**：论文报告：在BFCL相关任务中，Environment Tuning取得有竞争力的域内表现，并改善域外泛化；不能由此推断所有环境中都有效。

**做法**：将由易到难的课程、能提供纠错反馈的环境增强和细粒度进度奖励结合起来，让Agent直接围绕问题实例进行探索学习。

图解：三个训练设计分别提供什么帮助
- 结构化课程：组织由易到难的问题实例，支持稳定学习。
- 可操作的环境反馈：环境增强提供纠错反馈，帮助继续探索。
- 进度奖励：用更细的进度信号引导学习，而不只依赖任务结束结果。

## Grammar Search for Multi-Agent Systems

多Agent系统不一定要靠模型自由写代码才能设计。

- ID：acl-2026.acl-long.75
- 问题：Q06；轨道：main
- 来源：https://aclanthology.org/2026.acl-long.75/
- 选取理由：补充协作结构设计路线，提供“更自由生成未必更好”的有条件对照，不将其扩展为普遍负结果。

**问题**：已有自动设计多Agent系统的方法常让语言模型自由搜索代码空间，候选结构不易控制，也可能增加搜索成本和理解难度。

**发现**：论文报告：在数学与问答测试、两类骨干模型的比较中，结构化搜索在多数基准上优于所比较路线，并报告了搜索成本与可解释性收益。

**做法**：将系统候选限定为一组可组合组件，通过结构化方式探索组合，得到模块化的多Agent系统；摘要不足以列出具体组件或搜索算法细节。

## Explicit Trait Inference for Multi-Agent Coordination

协作时记录伙伴是否可靠、擅长什么，再据此调整决策。

- ID：acl-2026.acl-long.77
- 问题：Q06；轨道：main
- 来源：https://aclanthology.org/2026.acl-long.77/
- 选取理由：与协作结构搜索对照：前者改变系统组合，本篇改变Agent对合作伙伴的认识。

**问题**：多个Agent合作时，目标可能偏移，错误也可能层层传递；只交换消息未必足以理解伙伴的行为和能力。

**发现**：论文报告：显式特征推断在经济博弈与MultiAgentBench的部分设置中改善协作，并分析了伙伴画像与行动的关系；范围受场景与模型限制。

**做法**：根据交互历史跟踪伙伴的温暖度与能力两类心理维度，再将这些显式特征用于决策；它是行为建模思路，不是对Agent真实心理的断言。

## Robust Tool Use via Fission-GRPO: Learning to Recover from Execution Errors

工具调用报错后，学习修正，而不是反复重试同一个错误。

- ID：acl-2026.acl-long.1880
- 问题：Q05；轨道：main
- 来源：https://aclanthology.org/2026.acl-long.1880/
- 选取理由：补充Q05训练式恢复，区别于首批XENON对知识和依赖关系的明确更新。

**问题**：工具报错后，小模型可能重复无效调用；只给负奖励会丢失丰富的失败信息，而预先收集的纠错数据又可能跟不上当前策略的错误。

**发现**：论文报告：Fission-GRPO在BFCL多轮任务中改善错误恢复与总体准确率，并在TAU相关测试中展示迁移收益；具体比较条件需查看实验。

**做法**：把失败轨迹转成新的训练实例，加入错误模拟器提供的诊断反馈，再用当前策略采样多个恢复尝试，让纠错训练围绕实际出现的错误进行。

图解：从一次执行错误到新的恢复训练
- 遇到执行错误：使用当前策略实际产生的失败轨迹。
- 加入诊断反馈：错误模拟器提供反馈，将失败转换为训练实例。
- 采样恢复尝试：当前策略生成多个恢复轨迹，用于学习如何纠错。

## AgenTracer: Who Is Inducing Failure in the LLM Agentic Systems?

先找出是哪一步、哪个Agent引发失败，再谈纠错。

- ID：iclr-2026-134ed7a477770f227f12450ef0cbb8f4
- 问题：Q05；轨道：main
- 来源：https://proceedings.iclr.cc/paper_files/paper/2026/hash/134ed7a477770f227f12450ef0cbb8f4-Abstract-Conference.html
- 选取理由：将失败诊断与恢复训练并置，补充“先定位原因、再改行为”的不同环节。

**问题**：工具调用和协作协议越复杂，失败来源越难追踪；仅知道任务没有完成，并不能告诉系统应当修正哪一步。

**发现**：论文报告：AgenTracer在失败归因基准上优于所比较的大模型，并能向部分多Agent系统提供有用反馈；摘要不足以核实所有诊断的因果可靠性。

**做法**：通过反事实重放和程序化故障注入标注失败轨迹，构造训练数据，再用多粒度强化学习训练较小的失败追踪模型。

## AgentSuite: Toward More Reliable Agent Evaluation with a Component-Based Benchmark Auditing Pipeline

Agent答错了，也可能是任务、工具或判分器本身有问题。

- ID：openreview-2Exmr1eIKZ
- 问题：Q07；轨道：unknown
- 来源：https://icml.cc/virtual/2026/poster/66603
- 选取理由：与首批AgentNoiseBench的环境噪声鲁棒性区分，本篇检查评测任务本身是否有效。

**问题**：指令、环境、工具、标准轨迹和判分协议之间可能存在隐藏冲突；这些缺陷会把模型错误与评测产生的假象混在一起。

**发现**：论文报告：COBA在多个Agent基准上与专家判断具有较好一致性，并发现会影响评测结果的问题；这不等于所有自动审计判断都正确。

**做法**：把任务拆成用户、环境、标准答案与评测四个组件，用规则检测和按问题分类引导的语言模型检查诊断缺陷，并提供经过审计的基准版本。

## AgentLens: Revealing The Lucky Pass Problem in SWE-Agent Evaluation

代码最终通过测试，不代表Agent的解决过程可靠。

- ID：openreview-uHjkDW1QfY
- 问题：Q07；轨道：unknown
- 来源：https://neurips.cc/virtual/2026/poster/138951
- 选取理由：补充对结果指标的边界分析，与首批协作诊断和本批基准审计形成不同层面的可靠性对照。

**问题**：只看最终补丁能否通过测试，会把有计划的解决与反复盲试视为同样成功，因而忽略执行浪费、缺失验证和过程混乱。

**发现**：论文报告：在所分析的OpenHands与SWE-bench轨迹子集中，部分通过测试的过程仍表现出侥幸通过特征；过程评分还会改变模型排序，不能外推所有编码Agent。

**做法**：汇合同任务的多条成功轨迹，构建可接受行为的参考空间，再结合上下文标注探索、实现、验证和协调阶段，衡量过程质量与浪费信号。

图解：同样通过测试，过程质量仍可能不同
- 建立参考空间：合并同一任务的多条成功轨迹，表达可接受的行为路径。
- 理解行动阶段：依据轨迹上下文识别探索、实现、验证和协调，而非只看工具名称。
- 观察过程质量：分析浪费与偏离信号，区分不同质量的成功过程；不是泛化到所有任务的评分证明。
