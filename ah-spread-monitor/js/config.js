// 浏览器端数据中继地址（国内云函数，替代失效的公共 CORS 代理）。
// 留空则自动读取 localStorage('ahm_relay')——可在网页「管理品种」面板里填写，免去重新部署。
// 格式示例：https://abc-123.apigw.tencentcs.com/release/?url=
// 部署说明见 relay/README.md
window.RELAY_BASE = '';
