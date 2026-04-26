# 从源码详细解析osu!mania中星数/PP/分数的计算过程

![](https://i0.hdslb.com/bfs/new_dyn/e1333e16c818d302a9813703a5a5db81357685001.jpg@1416w_798h_1c)

**作者：Leo_Black**
**发布时间：2026年02月21日 23:10**
**标签：音游研究所**

---

# 零、前言

起因是主播在逛B站的时候，发现了有人解析了osu!std下星数的详细计算方法。评论区有人提问mania模式，可惜作者并不游玩mania，遂写此文，详细解析mania下星数、分数以及pp的计算方法。

![](https://i0.hdslb.com/bfs/new_dyn/5b896250fb3d27189377625796e0ceda357685001.png@1098w_304h)

*注意事项：*

1.  *本文涉及到部分计算机/编程名词以及相关概念，可能有一定门槛。*
2.  *建议活用大纲功能。*
3.  *斜体部分为说明部分，下划线为重点部分。*
4.  *本文将主要探讨osu!mania 4K的计算过程，其他轨道数量大同小异。*
5.  *如有错误敬请指正，欢迎讨论。*

---

# 一、星数计算

*本部分源码来自仓库ppy/osu。*

## 0. 整体流程预览

① 游戏获取谱面以及所选mods，进行预处理。

② 将谱面按0.4s划分为若干个段，并对每个小段落单独计算难度。

③ *\[核心\]* 按时间顺序遍历所有物件，计算出在每一个物件时刻处的难度(currentStrain)

④ 在每个段内，记录currentStrain的峰值，并将所有段的峰值按降序排序，用权重 0.9 依次加权求和得到技能值Difficulty

⑤最后根据公式 $\text{StarRating} = \text{Difficulty} \times 0.018$得到最后结果

*注意：为方便理解，本部分的说明顺序可能不与实际游戏的处理顺序相同。*

## 1. 预处理阶段

在这个阶段内，游戏将对谱面进行预处理，以便后面的计算。

游戏将所有物件按起始时间稳定排序、获取谱面元信息并将物件转化为对象。其中物件只包括单点和面头，不包含面尾。

## 2. 遍历阶段

在这个阶段内，游戏将按时间顺序升序遍历谱面中的所有物件。

### ① 前置知识

游戏使用了一个名为Strain的重要概念，直译为"压力、负担"，可以简单地理解为"瞬时难度"，这里为了避免歧义，下文统一使用其英文原名。

所有位置上的瞬时难度决定了最后的星数。在进行遍历时，游戏会根据当前物件在时间、位置上的特点为strain提供增量；与此同时，strain也会根据时间的流逝而逐渐衰减。

在解释strain是如何进行增减之前，你需要知道如下的概念：

-   物件：游玩时需要被击打的单点、长条。
-   物件时刻：每个物件（HitObject）被击打的时间点。
-   对象：即物件。
-   列：mania中的一个轨道。
-   Strain：一个大概念，它包含四个重要的状态变量：
    -   数组 individualStrains\[totalColumns\]：每列的当前 strain 值。
    -   值 overallStrain：全局 strain 值。
    -   值 highestIndividualStrain：临时变量，在处理每个物件时，取该时刻所有列 individualStrains 的最大值。
    -   值 CurrentStrain：当前时刻的总 strain 值（即 highestIndividualStrain + overallStrain）。

接下来的分析将主要围绕strain中的状态变量展开，它们综合起来将计算出最终的星数。

### ② 段落划分

接下来，游戏将进行处理。首先将时间轴划分为 400ms 的段。

-   对于第一个物件，初始化当前段结束时间 。
-   若当前物件时间在当前段的结束时间之后，则保存上一段的峰值，然后计算新段起始峰值（基于上一段结束时间到当前对象时间的衰减），并重置当前段的strain峰值为该值。
-   随后调用 StrainValueAt() 得到该物件的 strain 值，并更新当前段的strain峰值，同时将当前物件的 strain 值保存备用。
-   *（**关于这部分的各种函数和名词，下文将会解释**）*当进入新段时，函数 CalculateInitialStrain 将根据上一段结束时间到当前对象时间的衰减计算初始 strain，用于设置新段起始峰值。在 Strain 子类中，该方法的实现为：

即用上一时刻的 highestIndividualStrain 和 overallStrain 分别按各自衰减系数衰减到新段开始时间，再相加作为新段起始峰值。

那么strain是如何得到的呢？我们先看函数StrainValueAt()。

### ③ StrainValueAt()

*说明：这一部分的计算是游戏对不同"技能"(Skill)的"压力"(Strain)进行的加权累加。然而在mania中，不存在不同的技能，因此本部分的系数均为1，不影响计算，而其他模式（如 std）通常使用小于 1 的系数，因为它们有不同的技能（如acc、tap、aim等）*

这里的CurrentStrain就是指的是当前时刻的瞬时"压力"。它的初始值为0。

不难发现关键是函数 StrainValueOf()。接下来让我们详细分析一下。

### ④ StrainValueOf()

*说明：*

-   *applyDecay的公式为* $\text{value} \times \text{decayBase}^{\frac{\text{deltaTime}}{1000}}$
-   *maniaCurrent.DeltaTime 是与全局上一个物件的间隔（用于整体衰减和同时判断）。*
-   *maniaCurrent.ColumnStrainTime 是与同列上一个物件的间隔（用于单列衰减）。*
-   *当 DeltaTime ≤ 1 时，视为同时发生的多押，此时 highestIndividualStrain 取当前所有列的最大值（而不是直接替换为新列值），这避免了同时击打多列时 strain 被重复累加。*

通过分析源码我们得知处理的顺序如下：游戏首先会计算当前物件与当前列上一个物件的时间间隔DeltaTime，并通过applyDecay函数对当前列的individualStrains进行衰减，接着调用函数IndividualStrainEvaluator.EvaluateDifficultyOf()对其累加；随后，更新当前物件时刻所有列的最大strain命名为highestIndividualStrain；最后，再用同样的方法对当前物件时刻的overallStrain进行衰减并调用OverallStrainEvaluator.EvaluateDifficultyOf()进行累加。

两种衰减常数如下：

-   individual\_decay\_base = 0.125（每列 strain 衰减较快）。
-   overall\_decay\_base = 0.30（全局 strain 衰减稍慢）

这很好理解——当我进行击打物件操作时，我的"压力"肯定在升高；而当我完成击打后，我的手已放松，那么"压力"就随时间而慢慢下降了。这有点像笨鸟先飞小游戏：我进行一次操作，鸟往上飞一点，即"压力"高一些；我快速地操作，那么鸟很快就飞到最上方了；我不进行操作，鸟就会慢慢往下掉。

那么问题来了：individualStrains和overallStrain又是如何累加的呢？即"压力"是如何升高的呢？下面我们来看看前文涉及到的两个函数。

### ⑤ IndividualStrainEvaluator.EvaluateDifficultyOf()

*说明：*

-   *基础贡献：每个对象至少贡献 2.0 到其所在列的 individualStrain。*
-   *被长条覆盖时：若当前物件（可能是单点或长条头部）完全位于某个之前处理过**不在同一列内的**长条时间段内（即该长条开始早于当前开始，结束晚于当前结束），则说明该物件**被长条覆盖。*
-   *长条尾部不单独作为对象，因此这里只考虑头部。*

可以看出，在处理一个物件时，首先该物件贡献 2.0 （即holdFactor = 1）到其所在列的 individualStrain。随后判断，如果当前物件时刻的其他列已有长条被按下（即"被长条覆盖"），说明存在按住一个键的同时击打另一键的额外难度，该物件贡献增加至2.5（即holdFactor = 1.25）。最后根据该系数返回individualStrain增量。

### ⑥ OverallStrainEvaluator.EvaluateDifficultyOf()

*说明：*

-   *holdFactor：与 individual 中的覆盖条件相同，若当前对象被某个之前的长条完全覆盖，则全局难度系数提高至 1.25。*
-   *isOverlapping：判断是否存在"嵌入"关系（当前对象完全在某个之前对象的时间段内，但不一定被完全覆盖）。这用于触发释放时间差的惩罚。*
-   *closestEndTime：计算当前对象结束时间与所有之前对象结束时间的最小差值。这代表最近的一个释放事件与当前对象释放时刻的接近程度。*
-   *holdAddition：只有当存在"嵌入"时才计算，使用 Logistic 函数：*

$$\mathrm{Logistic}(x) = \frac{1}{1 + e^{-0.27(x - 30)}}$$

*其中 x 为* *closestEndTime，单位ms。*

-   *最终返回值：范围从 1.0（无重叠、无覆盖）到最大值 2.5（有覆盖且释放时间差很大）。*

分析源码可知，与前文individual相同，游戏同样进行了覆盖检查并对holdFactor进行调整。不同之处在于游戏进行了重叠检查，其仅检测了当前对象是否完全在某个之前对象的时间段内，但不一定被完全覆盖。若检测到重叠，则计算当前对象结束时间与之前对象结束时间的最小绝对差，随后根据这个时间差，通过 Logistic 函数计算出holdAddition系数，否则系数为0。最后根据holdAddition和holdFactor两个系数返回overallStrain增量。

那么holdAddition系数有什么用呢？根据下方的 Logistic 函数图像我们可以得知：当 x 远小于 30ms 时，值接近 0；远大于 30ms 时，值接近 1；在 30ms 附近平滑过渡。30ms与250bpm下的1/8相同。这模拟了释放时间差的难度：如果两个释放时间非常接近，可以同时抬手，难度低；如果相差较大，需要精确控制释放时机，难度逐渐增加至饱和。

*注：在2024-10Rework之前，该函数图像有变化，如下图二所示。*

![](https://i0.hdslb.com/bfs/new_dyn/b1c630c1c8447104ff9cfad2126c6d25357685001.png@1192w)

横坐标为对数坐标

![](https://i0.hdslb.com/bfs/new_dyn/d00b7a3452c23ced1d83253aa56ef3ce357685001.png@1192w)

Rework之前(红色)与Rework之后(紫色)的图像变化

在完成这些后，我们终于回到了最开始StrainValueAt()的部分。在计算完全部的累加后，StrainValueAt()返回一个增量在currentStrain上，作为当前的瞬时难度并记录下来。同时更新当前段的峰值。

## 3. 最终阶段

至此，我们终于完成了strain的累加。现在我们已经有了在每个物件时刻的strain值和每个段的strain峰值，可以着手星数的最终计算了。但是首先我们得先处理一些特殊情况。

DifficultyValue()

*说明：*

-   *GetCurrentStrainPeaks() 返回所有已保存的段峰值列表，加上当前未结束段的 currentSectionPeak。*
-   *过滤掉零值（排除无击打段）。*
-   *按降序排序，用权重 0.9 依次加权求和。这意味着最高的段峰值权重为 1，第二高的为 0.9，第三高的为 0.81，以此类推。这与下文将要提到的总PP计算相似，不过那边的权重是0.95。*
-   *最终得到难度 difficulty。*

最后我们有了难度值 difficulty ，用我们最开始提到的星数公式：

$$\text{StarRating} = \text{Difficulty} \times \text{difficultyMultiplier}$$

得到了最后的结果。

*注：这里的difficulty\_multiplier因模式和不同的技能而变化，在mania中只有一种技能，系数为0.018。*

## 4. 常见问题

### ① "之前对象"的含义

-   在 OverallStrainEvaluator 中，maniaPrevious 来自 maniaCurrent.PreviousHitObjects，它包含所有列中比当前对象时间更早的最近一个对象（每个列一个）。这用于检测跨列重叠。
-   在 strain 衰减中：
    -   individualStrains 衰减使用 maniaCurrent.ColumnStrainTime，即与同列上一个对象的间隔。
    -   overallStrain 衰减使用 maniaCurrent.DeltaTime，即与全局上一个对象的间隔。

### ② CurrentStrain 的作用与更新

CurrentStrain 是基类中维护的当前总 strain。由于 StrainDecayBase = 1，衰减步骤无效。StrainValueOf 返回 highestIndividualStrain + overallStrain - CurrentStrain，带入原式中，即CurrentStrain = CurrentStrain + (highestIndividualStrain + overallStrain - CurrentStrain) = highestIndividualStrain + overallStrain，不难看出这样更新后的 CurrentStrain 就等于 highestIndividualStrain + overallStrain。因此 CurrentStrain 始终代表当前时刻的总 strain，用于段峰值的记录。

### ③ 对 individualStrains 和 overallStrain 分工的理解

-   individualStrains：专注于同列的压力，每个列独立累积。每处理一个对象，该列的 strain 先按本列间隔衰减，然后加上 IndividualStrainEvaluator 的贡献（基础 2.0，被长条覆盖时 2.5）。highestIndividualStrain 取所有列中的最大值，代表当前最难列的压力。这反映了单指敲击密度和长条覆盖下的额外难度。
-   overallStrain：专注于全局复杂性，特别是跨列的时间关系（重叠、释放时机）。它通过 OverallStrainEvaluator 评估，返回值乘以 holdFactor（有覆盖时 1.25）并加上基于释放时间差的 holdAddition，范围在 1.0 到 2.5 之间。这模拟了多指协调、释放精度等全局难度。

长按的难度主要通过 overallStrain 体现：长条头部作为对象参与计算，其重叠关系、释放时间差都会影响 overallStrain。同时，IndividualStrainEvaluator 中的 holdFactor 也反映了长条对单点的影响。因此，长按的难度被分解为：

-   按下时的单列压力（individual，可能因被覆盖而提高）
-   释放时与后续对象的交互（overall，通过释放时间差）

## 5. 应用与体现

### ① 面乱的加成

近年来随着现代pp图不断地上架，玩家逐渐发现了它们都有一个共同的特征——都包含面乱或LN Roll。那么为什么它们在这个版本如此吃香呢？我们以mint的鬼畜妹和pus为例，简单分析一下。

![](https://i0.hdslb.com/bfs/new_dyn/f088b455a6656b70e66dcce4e0f6577d357685001.png@1192w)

最終鬼畜妹フランドール・S (かめりあ\'s \"最強災厄魔神兇刃暴君暗雲狂鬼凶悪終焉襲撃爆砕莫大破滅殺戮崩壊暗黒妹・六六六\" Remix) \[\[4K\] Calamity at the Scarlet Mansion\] *By -mint-*

观察上图，已知LN长度为100ms，可以发现这个部分存在重叠。推算出clostestEndTime为40ms，根据 Logistic 函数计算出holdAddition系数为0.937。当值为50ms时，系数将进一步提升至0.996，再往后则提升不大。此时overallStrain增量为 (1 + 0.996) \* 1 = 1.996，再加上本身individualStrain也包含2.0的基础增量，最后使得currentStrain能吃到相当多的加成。

![](https://i0.hdslb.com/bfs/new_dyn/b672dd12b80bc95934d0bda3dbc07654357685001.png@1192w)

Parallel Universe Shifter \[\[4K\] Quantum Field Disruption\] *By aquellex，BilliumMoto，lemonguy，Abraxos，\[Crz\]Crysarlene，Toaph Daddy，MyZterioN-，-mint-，elexire，guden 和 0DZ0*

再如pus，2轨的短LN同时吃到了3轨的覆盖加成和4轨的重叠加成，holdAddition系数经计算得0.869，overallStrain增量为 (1 + 0.869) \* 1.25 = 2.336 更加离谱。且这段速度较快，overallStrain衰减系数较小导致整体strain居高不下。

现在的高星LN图中，大部分撑星段都用的是类似的方法。不一定是乱，有些面切中也包含了覆盖和重叠加成，只是面乱在这两个加成中最吃香。

### ② 大叠与面叠的加成

叠谱的影响较为简单，这里不再举例。机制如下：

每个多押中的对象依次处理，由于 DeltaTime ≤ 1，overallStrain 会累加每个对象的 OverallStrainEvaluator 贡献。在7K中，若多押包含 7 列，则 overallStrain 一次增加约 7.0， highestIndividual 取其中一列的最高值（约 2.0），总 strain 可达 9.0 左右。这也是同bpm下，多K叠的星数远远比4K高的原因。

若多押中包含长条，且长条与其他列有覆盖关系，holdFactor = 1.25 会进一步提高每个对象的 overall 贡献，同时 IndividualStrainEvaluator 也可能因被覆盖而给 2.5 的 individual 增量，进一步推高 highestIndividual。例如，一个7押，其中几列为长条且释放时间错开，就能产生极高 strain。如下图所示，该图最终为14.04星。

*注：在2024-10 rework之前，LN多押还有额外加成。这也是为什么以前的面切星数如此之高。*

![](https://i0.hdslb.com/bfs/new_dyn/9033dcdace4945c72d83aba7bac544ce357685001.png@1192w)

Once Forgotten, Nothing Remains \[\[7K\] Nonexistence(original 14.04\* version)\] *By tyrcs*

### ③ Release减益

这种Release主要体现为谱面包含大量长条，但长条之间在时间上不重叠（一个长条结束后另一个才开始），且长条头部之间间隔较大。从算法上看，每个长条头部仅视为普通对象，IndividualStrainEvaluator 贡献 2.0（若无覆盖）。长条释放时没有单独对象，释放难度仅体现在后续对象中，但如果后续对象不重叠（例如下一个长条在释放后才开始），则释放时间差不会触发 holdAddition（因不满足重叠条件），释放的精确时机完全不被计入。按住长条并准确释放本身需要注意力，尤其是在快速切换长条时，手指协调和时机的把握并不简单。但算法忽略了这种"非重叠长条"的额外难度，导致其星数远远低于预期。例如下图，该谱面仅3.28星。

![](https://i0.hdslb.com/bfs/new_dyn/da2b41c1710955282e220e73f9939be2357685001.png@1192w)

夜曲 \[\[4K\] Hylotl\'s November\] *By Hylotl*

### ④ 普通乱以及子弹/盾/反盾/单纵的减益

普通乱在计算时，既吃不到多押增益也吃不到重叠与覆盖增益。当在某一列上individualStrain持续衰减的时刻，其他列出现物件。此时更新的highestIndividualStrain显然是极低的。故普通乱的星数是最低的。（如Malody Dan Cource v2 Speed- Extra 9 +HT）

长条释放后，紧接着（例如 10ms 后）出现一个同列的单点（即反盾），时机要求高。然而，由于算法不考虑面尾，因此本列的上一个物件仍然是面头，这个时候individualStrain已经衰减相当长一段时间了。同时，当前对象（单点）与之前的长条在时间上不重叠（因为长条已结束），所以 isOverlapping = false，holdAddition 不计算。尽管 closestEndTime 可能很小（10ms），但因不重叠，overall 贡献仅为 1.0（若也无覆盖）。这也是子弹以及纵的星数低的主要原因。

同理，盾几乎被处理为子弹，这部分与反盾大同小异，这里不再赘述。

## 6. 目前新兴的算法

*\[Crz\]sunnyxxy的文章Star Rating Rebirth下文简称sunny rework。*

### ①简述

Sunny Rework是由\[Crz\]sunnyxxy提出的一个通用的、适用于所有 VSRG（包括 osu!mania、Malody、Stepmania 等）的难度计算算法，克服现有算法的局限性（如过度依赖密度、模式枚举困难、易被针对等）。目前在国内社区被认可，虽有部分瑕疵，仍然是目前最准确的难度算法之一。

### ②核心算法

该文章提出的核心算法基于五个关键难度特征：同列压力（反映单列密度与节奏紧凑度）、跨列压力（量化交替移动的难度）、按压强度（类似密度但更精细地计入长条持续按压）、不均匀性（惩罚过于均匀的相邻列节奏）和释放因子（衡量长条释放时机的精确难度）。这些特征随时间变化，经平滑处理后通过非线性组合得到难度函数，再以局部物件数为权重提取高难度百分位（如93%和83%分位）并与加权平均融合，最终经长度归一化得到星数。

然而，该算法的复杂性可能导致实现和调试困难，目前在社区缓慢推动中。

### ③与目前算法的区别与联系

当前算法主要通过单列和整体strain的累积、分段峰值加权来评估难度，核心思路相对简洁，但忽略了跨列交替、释放精度、节奏均匀性等因素。新算法则针对这些盲点设计了专门特征，将难度分解为多个正交维度，并采用密度加权百分位与加权平均结合的方式提取最终值，在模型复杂度与精度之间寻求平衡。两者均以时间序列分析为基础，但新算法更全面地覆盖了VSRG难度的多维度特性。

## 7. 总结与局限性

osu!mania 4K 的星数计算通过将时间轴划分为 400ms 的段，记录每个段内的最大 strain 值（由单列最大压力和全局复杂性叠加而成），然后按降序加权求和得到技能值，最后乘以 0.018 。整个过程模拟了不同键型对玩家手指压力与协调能力的要求。

目前来说，该算法仍然不太准确，有如下局限性：

-   **释放时机难度被忽略**
    -   非重叠长条的释放时机要求很高，但由于不满足重叠条件，OverallStrainEvaluator 中的 holdAddition 不会触发，释放精度完全不计入难度。
    -   长条释放后紧接的单点（即使时间间隔极短）也因不重叠而无法获得释放难度加成。
-   **列间距离无影响**
    -   算法平等对待所有列，相邻列交替在 strain 计算上没有区别，实际上单手切对实际能力要求高。
-   **节奏复杂性量化不足**
    -   复杂节奏（切分音、附点、三连音等）仅通过击打密度（DeltaTime）间接影响 strain，没有专门的节奏模式评估。同样密度下，复杂节奏谱面可能比匀速更难，但星数可能相近甚至更低。
-   **低估低速高精度谱面**
    -   由于 strain 依赖时间间隔（DeltaTime），低 BPM 谱面中 DeltaTime 大，衰减快，导致 strain 峰值难以累积，最终星数偏低。然而低速谱面常要求极高的击打时机精度，实际难度并不低。（如Release）
-   **耐力的体现较弱**
    -   算法通过段峰值加权强调"最难片段"，但忽略了长时间中低强度但持续的压力。虽然连打会产生一定 strain，但若峰值不高，加权后可能不如短时复杂段落突出，而耐力要求本身也是难度的一部分。
-   **长条头部与尾部分离处理导致不连续**
    -   长条尾部不作为独立对象，其释放难度仅通过后续对象的 overallStrain 间接体现，且需要满足重叠条件。这导致释放难度无法连续累积，可能遗漏某些精准释放的挑战。

---

# 二、 PP计算

在完成星数计算后，pp的计算在mania中相对简单得多。它没有其他模式的多维pp，只需简单计算即可求得最终pp。由于本部分源码基本为公式，且公式过长，我将不再引用代码块，并将公式拆分为了各个小部分，为其命名。请注意不是官方名称。

## 0. 整体流程预览

① 获取成绩的详细信息以及谱面信息。

② 计算谱面最大PP，成绩PPAcc与mod惩罚。

③ 计算最终PP。

下方说明将省略第一步。

## 1. 最大PP

根据上文的星数，我们可以得到该谱面的最大PP：

$$PP_{max} = \left[8 \bigl(\max(\text{starRating} - 0.15, 0.05)\bigr)^{2.2}\right] \times \text{bonus}$$

其中物量奖励(bonus)的计算如下：

$$\text{bonus} = 1 + 0.1 \cdot \min\!\left(1, \frac{\text{totalHits}}{1500}\right)$$

*说明：*

-   *totalHits 是总物件数，**不是combo。**如果总物件数 ≤ 1500，则长度奖励因子 = 1 + 0.1*(totalHits/1500)，最大 1.1（当 totalHits = 1500 时）。*
-   *如果 totalHits > 1500，则奖励因子恒为 1.1。*
-   *这意味着谱面越长（最多到 1500 物件），pp 会获得最高 10% 的加成；超过 1500 后不再增加。*
-   *最大pp是一个典型的幂函数曲线，使得星数越高，pp 增长越快。两个公式的函数图像如下：*

![](https://i0.hdslb.com/bfs/new_dyn/f367ea303f6fb3be981253cfaeaeab1e357685001.png@1192w)

物量奖励函数图像 x为物量 y为系数

![](https://i0.hdslb.com/bfs/new_dyn/22fee61f3b9c2d09b7ba2fd3678eee26357685001.png@1192w)

当物量≥1500时的最大PP与星数关系图

## 2. PPAcc与精度因子

精度因子直接影响了你能获取的pp，它与PPAcc呈线性关系。在这之前我们先来看看如何计算PPAcc：

$$Acc_{pp} = \frac{\text{countPerfect} \cdot 320 + \text{countGreat} \cdot 300 + \text{countGood} \cdot 200 + \text{countOk} \cdot 100 + \text{countMeh} \cdot 50}{\text{totalHits} \cdot 320}$$

随后，根据下面公式计算精度因子：

$$\text{AccFactor} = \max(0, 5 \cdot Acc_{pp} - 4)$$

*说明：*

-   *当 PPAcc < 0.8（即 80%）时，5*acc - 4 < 0，该项取 0，表示低于 80% 精度的成绩不计入 pp。*
-   *当* *PPAcc* *= 1.0（全彩/理论值）时，精度因子的值为 1。*
-   *当* *PPAcc* *= 0.9 时，**精度因子的**值为 0.5；**PPAcc* *= 0.95 时，值为 0.75。*
-   *这体现了精度对 pp 的线性奖励，从 80% 到 100% 线性增长。*
-   *精度因子函数图像如下图所示。*

![](https://i0.hdslb.com/bfs/new_dyn/694216f9dbeadf674ceaa6095e33dedc357685001.jpg@1192w)

精度因子函数图像 x为PPAcc y为因子

## 3. 最终计算与mod惩罚

在mania中，与时间相关的mod（DT/HT）不直接影响pp，通过改变星数来影响谱面最大pp。根据前文的分析，CS、AR、OD和HP不影响星数计算，则影响这四项的mod（EZ除外）也就不影响pp的计算。

最终，获得的pp为：

$$PP = \text{AccFactor} \times PP_{max} \times \text{modMultiplier}$$

其中当启用EZ时，modMultiplier的值为0.5；当启用NF时，modMultiplier的值为0.75；同时启用时，modMultiplier的值为0.375；否则modMultiplier的值为1。

如果展开来写，则：

$$\text{pp} = \underbrace{8 \cdot (\max(\text{starRating} - 0.15, 0.05))^{2.2}}_{\text{谱面基础PP}} \times \underbrace{\max(0, 5 \cdot Acc_{pp} - 4)}_{\text{精度因子}} \times \underbrace{\left(1 + 0.1 \cdot \min\!\left(1, \frac{\text{totalHits}}{1500}\right)\right)}_{\text{物量奖励}} \times \underbrace{\text{modMultiplier}}_{\text{Mod系数}}$$

以下图我的bp1为例，星数为9.32。显然物量非常大，奖励为上限值1.1。由此可以得到本图的最大pp为1153pp。计算得我成绩得PPAcc为95.08%，对应的精度因子为75.4%，最后求得我的pp为869.392，与实际一致。

*注意：本成绩使用lazer游玩，其显示的最大combo27055并非总物件数，这是因为**在 ScoreV2 里，LN有 2 次判定，算两个combo。当然此处的物件数仍远远大于1500。*

![](https://i0.hdslb.com/bfs/new_dyn/2fba5ca9e074933cc2cb1c389804d6ae357685001.jpg@1192w)

*由雨沐查分机器人生成 图中玩家为本文作者*

## 4. 单曲pp与总pp之间的关系

我们直接用实际举例：

![](https://i0.hdslb.com/bfs/new_dyn/72a73804314e2145729230efc0109671357685001.png@1192w)

如图所示，这是我的前16个bp。你可能会注意到，图中一首歌有两个pp，还有一个权重。这里与前面计算星数的最后阶段DifficultyValue()中类似，将你游玩的所有成绩的单曲pp按降序排序，用权重0.95加权求和。例如，bp15的权重为0.95^(15-1) = 48.76% ≈ 47%，与图中一致。bp15的单曲pp为722pp，加权后得到加权单曲pp为352pp。最后将200个最佳加权单曲pp求和即为总pp。

## 5. 不同计分方式对pp的影响

随着顶级玩家saragi在lazer的表现，越来越多的玩家发现lazer可以刷更多的pp。这主要是因为lazer使用scoreV2计分方式（以下简称sv2）导致的结果。

### ① 什么是scoreV2？

官方wiki的解释如下：

> ScoreV2 是全新一代的分数系统。它的宗旨是对所有游戏模式的分数系统进行标准化，例如在 1.00x 的分数倍率下，完美分数即为 1,000,000，再加上 osu! 的转盘加分，osu!taiko 的长条加分，osu!catch 的香蕉加分。区别于以往对每个打击物件赋值的计分方式，这种计分方式更专注于每个物件相对于 100 万上限的占比。
>
> 除了更好的标准化外，ScoreV2 也是对长谱面连击数较多而导致产生整数溢出问题的解决方案。因为游戏的总分会被存储为一个 32 位的整数，而 ScoreV1 理论上能给出的分数是无限的，这就会导致分数值超过 32 位整数的理论极限 2,147,483,647，从而让分数计算器倒转产生负数分值（看上去就像是分数开始慢慢减少）。实际上，理论最高分超过该限制的长谱面取得的成绩会自动使用 ScoreV2 计分。
>
> 游玩时 ScoreV2 不会默认打开。在单人游戏时，可以通过不计入排名的 ScoreV2 模组打开，而在多人游戏时， ScoreV2 可以在设置比赛时作为获胜条件使用。

你可能不知道它是什么，但是你肯定听说过游玩ln段位需要开启sv2，或比赛必须使用sv2。在mania中，最大的区别在于面尾判定发生了变化：

> ScoreV2 模组改变了 osu!mania 判定机制中的一些东西：
>
> PERFECT 判定区间更改为：OD ≤ 5 时为 22.4 - 0.6 × OD，当 OD ≥ 5 时为 24.9 - 1.1 × OD。长按音符的头部与尾部单独收到判定，类似于两个常规音符。长按音符尾的释放判定区间长度变为原来的 1.5 倍。若在长按音符体中松开按键，则音符尾的判定不会高于 MEH。再次，若较晚的按键点击或释放落在 MEH 区间内，则会得到 MISS。

并且acc计算方式发生了变化。在scoreV2下，acc的计算方法为：

$$Acc_{v2} = \frac{\text{countPerfect} \cdot 305 + \text{countGreat} \cdot 300 + \text{countGood} \cdot 200 + \text{countOk} \cdot 100 + \text{countMeh} \cdot 50}{\text{totalHits} \cdot 305}$$

与前文提到的PPAcc计算方式仅有系数的不同。

### ② sv1对PPAcc的影响

在了解sv2对PPAcc的影响之前，你需要先知道平时在游玩反键时为什么会容易反彩（即黄比彩多）。在sv1下，面条的判定取决于面头按下按键、面尾松开按键的准确度，最后再整体给出一个判定。具体的判定如下图所示。其中整体打击误差=音符头打击误差+音符尾打击误差（均为正值）。

![](https://i0.hdslb.com/bfs/new_dyn/886b55ea4061b876d189df33d283282f357685001.png@1192w)

由此可见，当在游玩高密度反键切时，我们常常在抓面头时已拼尽全力，没有更多精力抓面尾。那么此时我们很多打击误差都会落在上图中GREAT部分，从而导致我们反彩。反彩对pp是严重的问题，因为我们知道sv1下黄并不会扣acc，但是无论计分方式，都会扣PPAcc。这样下来精度因子就会很低从而导致pp很低。这也是为什么有时我们发现自己的acc比别人高，但是pp却比其他人低。

### ③ sv2对PPAcc的影响

由上文分析可知，sv2使得面头和面尾分开判定。这样下来，当玩家在游玩时，可以只注意抓面头，面尾不用管，根据糖水不等式

$$\frac{\text{cntGreat}}{\text{cntPerfect}} < \frac{\text{cntGreat+1}}{\text{cntPerfect+1}} < 1$$

最终黄彩（即彩与黄的比值）会越来越高，从而使得PPAcc高，最终整体pp提高。

### ④ sv2的负面影响

当你在享受黄彩带来的加成时，别忘了sv2同时对彩和面尾的判定区间进行了调整。一般来说，当od > 7.6时，彩判会比stable更加严格。同时面尾的判定也会更加严格。至于这些负面影响能否与黄彩的加成平衡，由各位自行权衡。

![](https://i0.hdslb.com/bfs/new_dyn/f9d8fdf4f894d56bf539aeaa1c5b4a38357685001.png@1192w)

（OD≥5） OD与彩判的关系图

---

# 三、分数计算

谈到scoreV1和scoreV2，离不开的就是它们之间的计分方式区别。更为甚者，lazer和stable scoreV2的计分方式也有区别。遗憾的是，stable是闭源的，我无法通过源码分析分数的实现，且ScoreV2 计分系统被暗改了多次（官方未将其整理为可浏览的文档），我只能以萌娘百科、HIOSU、官方论坛和Wiki等方面搜集整理资料。我无法保证stable scoreV2信息100%可靠。但是我们仍可以分析lazer的分数实现。

## 1. scoreV1

*本部分信息来自官方Wiki。此部分可能会过时，请注意辨析。*

scoreV1分数分为两部分：基础分和奖励分，各占总分的50%。其中：

-   基础分遵循实际的判定。最终的基础分$\text{basicScore} = 500000 \times \text{ModMultiplier} \times Acc_{pp}$
-   奖励分基于实际判定和一个浮动的奖励倍率。倍率会随着彩300或黄300增加，随着200及以下减少。判定越好，倍率增加越多/惩罚越少。倍率有上限。奖励分计算公式如下：

$$\text{bonusScore} = \underbrace{\frac{\text{maxScore} \times \text{modMultiplier}}{2\cdot\text{totalNotes}}}_{\text{单个物件基础分}} \times \frac{\text{hitBonusValue}\times\sqrt{\text{bonus}_n}}{320}$$

$$\text{bonus}_n = \text{bonus}_{n-1} + \text{HitBonus} - \frac{\text{HitPunishment}}{\text{ModDivider}}$$

其中maxScore为1,000,000 ，totalNotes为总物件数，bonus的下角标为当前物件被击打时刻的值，其初始值为100，范围为\[0,100\]。其余变量见下表。

![](https://i0.hdslb.com/bfs/new_dyn/1e2eadc970526f2ea682bde79954f689357685001.png@1192w)

nK mod也会影响倍乘器 这里省略；多个mod倍率乘算

当击打事件发生时，计算一次分数，最后由基础分和奖励分合成总分数。

同样的判定组合，顺序不同会导致不同的 Bonus 值，分数也会不同。这种复杂性使得分数的不确定性极大。

## 2. Stable scoreV2

*本部分信息来自萌娘百科和**负责开发 ScoreV2 的 smoogipoo 在官网论坛里发表的 ScoreV2 反馈帖。**这也许和现在实际差距很大。如有错误敬请指正。*

stable scoreV2的分数分为两部分：20%的连击分和80%的准度分，最后再乘上模组倍乘器。除了NF倍乘系数改为1以外，其余与sv1保持不变。

-   对于准度分，计算如下：

$$\text{accScore} = \text{maxScore} \times Acc_{v2}^{2+2\cdot Acc_{v2}} \times \frac{\text{cntAlreadyJudged}}{\text{totalJudge}}$$

其中maxScore为1,000,000 ， Acc\_v2为scoreV2下的acc，cntAlreadyJudged为已判定的数量（这里并非物件的数量，是因为在 ScoreV2 里，LN有 2 次判定。），totalJudge为谱面总判定数量。

-   对于连击分，计算如下：

$$\text{comboScore} = \text{maxScore} \times Acc_{v2} \times \frac{\text{curComboMulti}}{\text{curMaxComboMulti}}$$

$$\text{curComboMulti} = \begin{cases}0.5 , \text{curCombo} \leq 1 \\ \log_4 {\text{curCombo}}, 2 < \text{curCombo} \leq 400 \\ \log_4 400, \text{curCombo} > 400 \end{cases}$$

$$\text{curMaxComboMulti} = \begin{cases}0.5 , \text{curMaxCombo} \leq 1 \\ \log_4 {\text{curMaxCombo}}, 2 < \text{curMaxCombo} \leq 400 \\ \log_4 400, \text{curMaxCombo} > 400 \end{cases}$$

其中curCombo为当前连击数，curMaxCombo为当前物件时刻最大连击数。其余与上方相同。

当击打事件发生时，计算一次分数，最后由准度分和连击分合成总分数。

当combo达到400时，连击分倍乘器达到最大值。所以在比赛中，漏一个的结果不单是准度分下降，从0到400combo的连击分也随之而去。

## 3. Lazer

*本部分信息来自官方仓库。*

### ① 整体流程预览

-   判定产生：根据玩家输入时间与 ManiaHitWindows 定义的窗口，游戏生成判定结果。
-   分数更新：每产生一个判定结果，调用 ManiaScoreProcessor.ApplyResult，该方法会：
    -   更新准确度累计值。
    -   通过 GetComboScoreChange 计算连击部分分数并累加到连击总分。
    -   通过基类机制累加奖励分。（mania不存在）
    -   更新当前连击数。
-   总分计算：任何时候可通过 ComputeTotalScore 获得当前总分，它基于连击进度、准确度进度和奖励分实时计算。
-   最终分数：谱面结束后，最终总分即为各部分的累加和。

### ② 分数构成

lazer的分数由三部分构成：15%的连击分、85%准度分和奖励分。其中奖励分在mania中为0。

任何时候可通过函数 ComputeTotalScore 获取当前总分，参数由基类传入：

*说明：*

-   *comboProgress 和* *accuracyProgress 分别为连击部分和准度部分，将在下文探讨。*
-   *Accuracy.Value 是sv2 Acc。*
-   *bonusPortion 是当前累积奖励分，在其他模式中存在，在mania中为0*
-   *游戏中存在模组倍乘器，但未在源码中直接得到体现。推测是在计算完最终分数后统一进行倍乘。（如EZ \* 0.5）*

### ③ 连击分的计算

每次判定对连击部分的贡献由函数 GetComboScoreChange 决定：

*说明：*

-   *常数 combo\_base = 4，因此乘数因子为 log\_4(comboAfter)，取值范围限制在 \[0.5, log\_4(400)\] 之间。* *log\_4(400) ≈ 4.322，即乘数最大约 4.322。*
-   *当连击数为 1 时，log\_4(1) = 0，但被下限 0.5 截断，因此首个判定也能获得 0.5 倍的基础连击分。*
-   *随着连击增加，乘数对数增长，连击数达到 400 后不再增加（上限饱和）。*
-   *注意在连击分部分，彩300的判定分仅为300，不是305和320！*

易知连击乘数因子初始值为0.5。每次发生击打事件时，获取当前combo、当前物件的判定和当前的连击分，再根据当前combo计算乘数因子，对当前物件的判定分进行乘算，得到该击打事件获得的单个连击分。最后将单个连击分加到当前连击分上，完成更新。

此时前文提到的comboProgress就等于当前连击分与当前最大连击分的比值。当前最大连击分指的是 令 从初始时刻 到 该物件时刻 全连 情况下的连击分。

### ④ 准度分的计算

准度分与Stable scoreV2相似，但有所不同。

$$\text{comboScore} = 850000 \times Acc_{v2} \times \frac{\text{cntFinishedTObj}}{\text{totFinishedTObj}}$$

其中cntFinishedTObj为已完成顶级物件数，totFinishedTObj为总顶级物件数。它们的比值即前文提到的accuracyProgress的值。顶级物件指的是是谱面中直接放置的、不依赖于其他物件的独立击打对象。在 osu!mania 中，顶级物件仅包括单点和面头；面尾以及长条中间的 tick（HoldNoteTick）都属于嵌套物件，它们依附于面头，不是顶级物件。

---

# 四、结语

不知不觉这篇文章就写了10个小时，也算是在一天内肝出来了。我个人层面上也学习到很多东西，希望能对大家有所帮助，感谢阅读。

---

# 参考内容

-   \[1\] 仓库地址：https://github.com/ppy/osu
-   \[2\] https://bot.365246692.xyz/
-   \[3\] https://osu.ppy.sh/users/21207706
-   \[4\] https://osu.ppy.sh/wiki/zh/Gameplay/Score#scorev2
-   \[5\] https://osu.ppy.sh/wiki/zh/Gameplay/Judgement/osu%21mania#scorev2
-   \[6\] https://zh.moegirl.org.cn/Osu!/ScoreV2
-   \[7\] https://bbs.hiosu.com/wiki\_list\_16\_0.html
-   \[8\] https://osu.ppy.sh/wiki/zh/Gameplay/Score/ScoreV1/osu%21mania
-   \[9\] https://osu.ppy.sh/users/1040328
-   \[10\] https://osu.ppy.sh/community/forums/topics/466617

---

*标签：*
- #osu!
- #osu!mania
- #音乐游戏
- #源码分析
- #技术
- #4K
- #Github
- #分析
- #lazer

*原文链接：https://www.bilibili.com/opus/1171874241845395474*

