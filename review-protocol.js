export const REVIEW_PROTOCOL = {
  version:'review-1',
  scope:'录像可观察事件，不等同官方技术统计',
  labels:[
    {id:'shot',name:'投篮动作',definition:'比赛中的明确得分尝试，包含可见上篮、跳投、扣篮和有意补篮。以球离手时刻定位；扣篮以球进入篮圈时刻定位。假动作、传球及死球随手投不算。是否记官方FGA另行判断。'},
    {id:'free-throw',name:'罚球',definition:'罚球线上的正式罚球，以球离手时刻定位，与运动战投篮分开。'},
    {id:'turnover',name:'失误',definition:'未完成投篮即丢失控球权；以对手明确获得控球或裁判宣判导致球权转换的时刻定位。需要判断双方实际控球，不能将所有传球失误动作直接记为失误。'},
    {id:'rebound',name:'篮板',definition:'投篮未中后的可确认控球或受控拨球，以首次明确控制时刻定位。在备注写进攻或防守篮板；争抢但未控制不算确认篮板。'}
  ],
  results:['made','missed','unknown','not-applicable'],
  checklist:['先确认有效比赛画面，排除回放和死球','定位动作时间并保留前后录像','核对事件类型、结果和球员；看不清留空或未知','检查重复标记及连续补篮','全段观看寻找机器漏检，不仅查看候选','报告列出未确认事件、未覆盖时段和样本限制'],
  sources:[{title:'FIBA统计员手册2024',url:'https://assets.fiba.basketball/image/upload/documents-corporate-fiba-statisticians-manual-2024.pdf'},{title:'Hudl人工与AI标注说明',url:'https://www.hudl.com/products/assist/faq'}]
};
