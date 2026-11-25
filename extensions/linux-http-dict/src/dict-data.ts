import type { LinuxCommandGroup } from './types'

export interface LocalizedText {
  zh: string
  en: string
}

export interface ExtraLinuxSpec {
  id: string
  name: string
  group: LinuxCommandGroup
  starsKey: 'stars5' | 'stars4'
  package: string
  description: LocalizedText
  aliases: { zh: readonly string[]; en: readonly string[] }
  params: ReadonlyArray<{ flag: string; desc: LocalizedText }>
  examples: ReadonlyArray<{ title: LocalizedText; cmd: string; note?: LocalizedText }>
}

export interface ExtraHttpSpec {
  code: number
  phrase: string
  rfc: string
  isRetryable: boolean
  meaning: LocalizedText
  causes: readonly LocalizedText[]
  troubleshooting: ReadonlyArray<{ step: LocalizedText; action: LocalizedText }>
  architectureNotes: LocalizedText
}

export interface ExtraPortSpec {
  port: number
  protocol: 'TCP' | 'UDP' | 'TCP/UDP'
  service: string
  category: LocalizedText
  description: LocalizedText
  securityNotice: LocalizedText
}

export const EXTRA_LINUX_SPECS: readonly ExtraLinuxSpec[] = [
  {
    id: 'cmd-curl',
    name: 'curl',
    group: 'net',
    starsKey: 'stars5',
    package: 'curl',
    description: { zh: '命令行 HTTP/HTTPS 接口调试、下载与响应耗时分析工具', en: 'Command-line HTTP/HTTPS client for API debugging, downloads, and timing' },
    aliases: { zh: ['接口调试', 'http请求', '下载', '测速'], en: ['http request', 'api test', 'download'] },
    params: [
      { flag: '-X POST', desc: { zh: '指定请求方法', en: 'Specify HTTP request method' } },
      { flag: '-H', desc: { zh: '添加自定义请求头', en: 'Add custom request header' } },
      { flag: '-d', desc: { zh: '发送请求体数据', en: 'Send request body payload' } },
      { flag: '-i / -v', desc: { zh: '打印响应头或完整握手调试过程', en: 'Include response headers or verbose handshake' } },
    ],
    examples: [
      { title: { zh: '发送带 JSON 载荷的 POST 请求', en: 'Send a POST request with JSON body' }, cmd: 'curl -X POST -H "Content-Type: application/json" -d \'{"ok":true}\' https://api.example.com/v1/ping' },
      { title: { zh: '查看 DNS/TCP/TLS/TTFB 各阶段耗时', en: 'Inspect DNS/TCP/TLS/TTFB timings' }, cmd: 'curl -o /dev/null -s -w "dns:%{time_namelookup} tcp:%{time_connect} ttfb:%{time_starttransfer} total:%{time_total}\\n" https://example.com' },
    ],
  },
  {
    id: 'cmd-wget',
    name: 'wget',
    group: 'net',
    starsKey: 'stars4',
    package: 'wget',
    description: { zh: '支持断点续传与后台下载的网络文件抓取工具', en: 'Non-interactive network downloader with resume and recursive support' },
    aliases: { zh: ['下载文件', '断点续传', '镜像下载'], en: ['download file', 'resume download'] },
    params: [
      { flag: '-c', desc: { zh: '开启断点续传', en: 'Continue partially downloaded file' } },
      { flag: '-O <file>', desc: { zh: '指定保存文件名', en: 'Write output to specified file' } },
      { flag: '-q', desc: { zh: '静默模式不输出进度条', en: 'Quiet mode without progress output' } },
    ],
    examples: [
      { title: { zh: '断点续传下载大文件并重命名', en: 'Download a large file with resume' }, cmd: 'wget -c -O release.tar.gz https://example.com/release.tar.gz' },
      { title: { zh: '后台静默下载并将日志写入文件', en: 'Download in background and log to file' }, cmd: 'wget -b -o download.log https://example.com/dataset.zip' },
    ],
  },
  {
    id: 'cmd-rsync',
    name: 'rsync',
    group: 'file',
    starsKey: 'stars5',
    package: 'rsync',
    description: { zh: '增量同步本地与远程目录，仅传输差异数据块', en: 'Incremental local and remote directory sync transferring only deltas' },
    aliases: { zh: ['增量同步', '远程同步', '备份', '传文件'], en: ['incremental sync', 'remote sync', 'backup'] },
    params: [
      { flag: '-a', desc: { zh: '归档模式（保留权限、软链与时间戳）', en: 'Archive mode preserving permissions and timestamps' } },
      { flag: '-z', desc: { zh: '传输时启用压缩', en: 'Compress data during transfer' } },
      { flag: '--delete', desc: { zh: '删除目标端多余文件以保持严格镜像', en: 'Delete extraneous files from destination' } },
      { flag: '--dry-run / -n', desc: { zh: '演练同步计划而不实际写入', en: 'Perform trial run without making changes' } },
    ],
    examples: [
      { title: { zh: '增量同步构建产物到远程服务器并显示进度', en: 'Sync build output to remote server with progress' }, cmd: 'rsync -avz --progress ./dist/ user@10.0.0.10:/var/www/app/' },
      { title: { zh: '演练镜像同步并排除 node_modules', en: 'Dry-run mirror sync excluding node_modules' }, cmd: 'rsync -avzn --delete --exclude=node_modules ./src/ /backup/src/' },
    ],
  },
  {
    id: 'cmd-journalctl',
    name: 'journalctl',
    group: 'system',
    starsKey: 'stars5',
    package: 'systemd',
    description: { zh: '查询 Systemd 结构化系统日志与守护进程输出', en: 'Query structured Systemd journal logs for services and boot events' },
    aliases: { zh: ['系统日志', '服务日志', 'systemd日志'], en: ['systemd logs', 'service logs', 'journal'] },
    params: [
      { flag: '-u <unit>', desc: { zh: '按服务单元名过滤日志', en: 'Filter logs by systemd unit name' } },
      { flag: '-f', desc: { zh: '实时追踪最新日志输出', en: 'Follow new log entries in real time' } },
      { flag: '-n 100', desc: { zh: '只显示最近 100 行', en: 'Show last 100 log lines' } },
      { flag: '--since', desc: { zh: '按起始时间窗口筛选', en: 'Filter logs since a given timestamp' } },
    ],
    examples: [
      { title: { zh: '实时跟踪 nginx 服务最近 50 行日志', en: 'Follow last 50 lines of nginx logs' }, cmd: 'journalctl -u nginx -n 50 -f' },
      { title: { zh: '查看过去 1 小时内的错误级别日志', en: 'Show error-level logs from the past hour' }, cmd: 'journalctl --since "1 hour ago" -p err' },
    ],
  },
  {
    id: 'cmd-tmux',
    name: 'tmux',
    group: 'system',
    starsKey: 'stars5',
    package: 'tmux',
    description: { zh: '终端多路复用器，断网不中断长耗时任务并支持分屏协作', en: 'Terminal multiplexer keeping long tasks alive across SSH disconnects' },
    aliases: { zh: ['终端复用', '后台会话', '防断连', '分屏'], en: ['terminal multiplexer', 'session', 'split pane'] },
    params: [
      { flag: 'new -s <name>', desc: { zh: '创建命名会话', en: 'Create a named session' } },
      { flag: 'attach -t <name>', desc: { zh: '重新挂载已有会话', en: 'Attach to an existing session' } },
      { flag: 'ls', desc: { zh: '列出所有运行中的会话', en: 'List active sessions' } },
    ],
    examples: [
      { title: { zh: '创建名为 deploy 的持久终端会话', en: 'Create a named session called deploy' }, cmd: 'tmux new -s deploy' },
      { title: { zh: '列出并重新接入已有会话', en: 'List and reattach to deploy session' }, cmd: 'tmux ls && tmux attach -t deploy' },
    ],
  },
  {
    id: 'cmd-sed',
    name: 'sed',
    group: 'text',
    starsKey: 'stars5',
    package: 'sed',
    description: { zh: '流式文本替换、按行切片与批量原地修改工具', en: 'Stream editor for regex substitution, line slicing, and in-place edits' },
    aliases: { zh: ['文本替换', '批量替换', '按行截取'], en: ['text replace', 'stream editor', 'in-place edit'] },
    params: [
      { flag: '-i', desc: { zh: '直接修改原文件（macOS 需写 -i ""）', en: 'Edit file in place (use -i "" on macOS)' } },
      { flag: '-n', desc: { zh: '抑制默认输出，配合 p 打印指定行', en: 'Suppress default output, print with p' } },
      { flag: '-E', desc: { zh: '启用扩展正则表达式', en: 'Use extended regular expressions' } },
    ],
    examples: [
      { title: { zh: '原地全局替换配置文件中的旧域名', en: 'Replace old domain globally in config file' }, cmd: "sed -i 's/old.example.com/new.example.com/g' nginx.conf" },
      { title: { zh: '仅提取日志文件的第 100 到 200 行', en: 'Extract lines 100 through 200 from log' }, cmd: 'sed -n "100,200p" /var/log/app.log' },
    ],
  },
  {
    id: 'cmd-chmod',
    name: 'chmod',
    group: 'security',
    starsKey: 'stars5',
    package: 'coreutils',
    description: { zh: '修改文件或目录的读、写、执行权限位', en: 'Change read, write, and execute permission bits on files or directories' },
    aliases: { zh: ['修改权限', '可执行权限', '755', '600'], en: ['permissions', 'executable', 'file mode'] },
    params: [
      { flag: '+x', desc: { zh: '添加可执行权限', en: 'Add execute permission' } },
      { flag: '-R', desc: { zh: '递归修改目录及内部所有文件', en: 'Apply changes recursively' } },
      { flag: '600 / 755', desc: { zh: '私钥仅本人读写 / 脚本与目录常用权限', en: 'Private key owner-only / standard executable mode' } },
    ],
    examples: [
      { title: { zh: '赋予部署脚本可执行权限', en: 'Make deployment script executable' }, cmd: 'chmod +x ./deploy.sh' },
      { title: { zh: '修复 SSH 私钥权限避免被拒绝连接', en: 'Fix SSH private key permissions' }, cmd: 'chmod 600 ~/.ssh/id_ed25519' },
    ],
  },
  {
    id: 'cmd-chown',
    name: 'chown',
    group: 'security',
    starsKey: 'stars5',
    package: 'coreutils',
    description: { zh: '变更文件或目录的所有者用户与所属用户组', en: 'Change file and directory owner user and group' },
    aliases: { zh: ['修改所有者', '用户组', '归属权'], en: ['owner', 'group', 'ownership'] },
    params: [
      { flag: '-R', desc: { zh: '递归更改整个目录树的归属', en: 'Recursively change ownership' } },
      { flag: 'user:group', desc: { zh: '同时指定新用户与用户组', en: 'Specify both owner user and group' } },
    ],
    examples: [
      { title: { zh: '将 Web 目录递归授权给 www-data 运行用户', en: 'Assign web root ownership to www-data' }, cmd: 'sudo chown -R www-data:www-data /var/www/html' },
      { title: { zh: '将当前目录归属恢复为当前登录用户', en: 'Reclaim directory ownership for current user' }, cmd: 'sudo chown -R "$USER:$USER" ./project' },
    ],
  },
  {
    id: 'cmd-ps',
    name: 'ps',
    group: 'system',
    starsKey: 'stars5',
    package: 'procps',
    description: { zh: '查看当前运行进程快照、命令行参数与资源占比', en: 'Report a snapshot of active processes, command lines, and resource usage' },
    aliases: { zh: ['进程列表', '查进程', 'pid', 'cpu占用'], en: ['process list', 'pid', 'cpu usage'] },
    params: [
      { flag: 'aux', desc: { zh: 'BSD 风格列出全部用户的完整进程信息', en: 'Show all processes for all users in BSD format' } },
      { flag: '-ef', desc: { zh: '标准风格显示 PID 与父进程 PPID', en: 'Full-format listing with PID and PPID' } },
      { flag: '--sort=-%mem', desc: { zh: '按内存占用倒序排列', en: 'Sort descending by memory usage' } },
    ],
    examples: [
      { title: { zh: '列出内存占用最高的前 10 个进程', en: 'Top 10 processes by memory usage' }, cmd: 'ps aux --sort=-%mem | head -n 11' },
      { title: { zh: '查找指定 Java 或 Node 进程的完整启动参数', en: 'Find full startup arguments of a node process' }, cmd: 'ps -ef | grep "[n]ode"' },
    ],
  },
  {
    id: 'cmd-kill',
    name: 'kill / pkill',
    group: 'system',
    starsKey: 'stars5',
    package: 'procps',
    description: { zh: '向指定 PID 或进程名发送信号实现优雅停机或强制终止', en: 'Send signals to processes by PID or name for graceful stop or force kill' },
    aliases: { zh: ['杀进程', '停止进程', '信号', 'kill -9'], en: ['terminate process', 'signal', 'stop process'] },
    params: [
      { flag: '-15 (SIGTERM)', desc: { zh: '默认优雅退出信号（允许清理资源）', en: 'Default graceful termination signal' } },
      { flag: '-9 (SIGKILL)', desc: { zh: '内核级强制杀死（无法捕获）', en: 'Immediate uncatchable termination' } },
      { flag: '-HUP', desc: { zh: '通知守护进程热重载配置', en: 'Reload daemon configuration without restart' } },
    ],
    examples: [
      { title: { zh: '先尝试优雅终止进程，卡死时再强制结束', en: 'Gracefully stop a process by PID' }, cmd: 'kill -15 <PID>' },
      { title: { zh: '按命令行关键字批量停止匹配进程', en: 'Stop processes matching a command pattern' }, cmd: 'pkill -f "node worker.js"' },
    ],
  },
  {
    id: 'cmd-scp',
    name: 'scp',
    group: 'net',
    starsKey: 'stars5',
    package: 'openssh-client',
    description: { zh: '基于 SSH 加密通道在本地与远程主机间拷贝文件', en: 'Securely copy files between local and remote hosts over SSH' },
    aliases: { zh: ['远程拷贝', '上传文件', '下载文件', 'ssh传文件'], en: ['remote copy', 'upload', 'ssh transfer'] },
    params: [
      { flag: '-r', desc: { zh: '递归拷贝整个目录', en: 'Recursively copy directories' } },
      { flag: '-P <port>', desc: { zh: '指定非默认 SSH 端口（大写 P）', en: 'Specify custom SSH port (uppercase P)' } },
      { flag: '-i <key>', desc: { zh: '指定身份认证私钥文件', en: 'Use specific identity private key' } },
    ],
    examples: [
      { title: { zh: '将本地压缩包上传到远程服务器', en: 'Upload local archive to remote server' }, cmd: 'scp -P 2222 ./app.tar.gz deploy@10.0.0.10:/opt/releases/' },
      { title: { zh: '从远程服务器拉取整个日志目录到本地', en: 'Download remote log directory locally' }, cmd: 'scp -r deploy@10.0.0.10:/var/log/app ./local-logs' },
    ],
  },
  {
    id: 'cmd-ssh',
    name: 'ssh',
    group: 'net',
    starsKey: 'stars5',
    package: 'openssh-client',
    description: { zh: '加密远程登录、跳板机穿透与本地/远程端口转发隧道', en: 'Encrypted remote shell login, jump host proxying, and port forwarding' },
    aliases: { zh: ['远程登录', '端口转发', 'ssh隧道', '跳板机'], en: ['remote login', 'port forwarding', 'tunnel', 'jump host'] },
    params: [
      { flag: '-L local:host:port', desc: { zh: '建立本地端口转发隧道', en: 'Forward local port to remote target' } },
      { flag: '-J bastion', desc: { zh: '通过跳板机中转直连内网主机', en: 'Connect via ProxyJump bastion host' } },
      { flag: '-N -f', desc: { zh: '仅建立后台隧道不执行远程命令', en: 'Run background tunnel without remote shell' } },
    ],
    examples: [
      { title: { zh: '将远程内网 MySQL 3306 映射到本地 13306', en: 'Tunnel remote MySQL 3306 to local port 13306' }, cmd: 'ssh -N -L 13306:127.0.0.1:3306 deploy@bastion.example.com' },
      { title: { zh: '通过跳板机一键直连内网业务服务器', en: 'Connect to internal host through bastion jump host' }, cmd: 'ssh -J ops@bastion.example.com app@10.0.1.20' },
    ],
  },
  {
    id: 'cmd-jq',
    name: 'jq',
    group: 'text',
    starsKey: 'stars5',
    package: 'jq',
    description: { zh: '命令行 JSON 解析、过滤、字段提取与结构转换工具', en: 'Command-line JSON processor for slicing, filtering, and transforming data' },
    aliases: { zh: ['json解析', '提取字段', 'json过滤'], en: ['json parse', 'json filter', 'extract field'] },
    params: [
      { flag: '-r', desc: { zh: '输出裸字符串（去掉双引号）', en: 'Output raw strings without JSON quotes' } },
      { flag: '-c', desc: { zh: '输出紧凑单行 JSON', en: 'Compact single-line JSON output' } },
      { flag: '.[].id', desc: { zh: '提取数组中每个对象的 id 字段', en: 'Extract id field from each array element' } },
    ],
    examples: [
      { title: { zh: '从接口响应中提取所有状态为 active 的用户名', en: 'Extract names of active users from API response' }, cmd: "curl -s https://api.example.com/users | jq -r '.items[] | select(.active==true) | .name'" },
      { title: { zh: '统计 JSON 数组长度并美化输出', en: 'Count JSON array length' }, cmd: 'jq ".items | length" response.json' },
    ],
  },
  {
    id: 'cmd-xargs',
    name: 'xargs',
    group: 'text',
    starsKey: 'stars5',
    package: 'findutils',
    description: { zh: '将标准输入转化为命令行参数并支持多进程并发执行', en: 'Build and execute command lines from stdin with parallel worker support' },
    aliases: { zh: ['管道传参', '批量执行', '并发执行'], en: ['pipe args', 'batch run', 'parallel'] },
    params: [
      { flag: '-0', desc: { zh: '按 NUL 字符分隔（配合 find -print0 防空格）', en: 'Use NUL delimiter (pairs with find -print0)' } },
      { flag: '-I {}', desc: { zh: '指定参数占位符位置', en: 'Specify placeholder for each input item' } },
      { flag: '-P 4', desc: { zh: '开启 4 个并发子进程', en: 'Run up to 4 commands in parallel' } },
    ],
    examples: [
      { title: { zh: '安全批量处理含空格的文件名', en: 'Safely process filenames containing spaces' }, cmd: 'find ./logs -name "*.tmp" -print0 | xargs -0 rm -f' },
      { title: { zh: '4 并发批量压缩当前目录下的图片或日志', en: 'Compress log files in parallel with 4 workers' }, cmd: 'ls *.log | xargs -P 4 -I {} gzip {}' },
    ],
  },
  {
    id: 'cmd-tail',
    name: 'tail',
    group: 'text',
    starsKey: 'stars5',
    package: 'coreutils',
    description: { zh: '查看文件末尾内容并实时跟踪线上滚动日志', en: 'Output trailing lines of files and follow live growing logs' },
    aliases: { zh: ['看日志', '实时日志', '尾部'], en: ['live log', 'follow log', 'end of file'] },
    params: [
      { flag: '-f / -F', desc: { zh: '实时追踪新增行（-F 支持日志轮转重开）', en: 'Follow new lines (-F survives log rotation)' } },
      { flag: '-n 200', desc: { zh: '输出最后 200 行', en: 'Display last 200 lines' } },
    ],
    examples: [
      { title: { zh: '实时跟踪应用日志并高亮过滤 ERROR 行', en: 'Follow app log and filter ERROR lines' }, cmd: 'tail -n 100 -F /var/log/app.log | grep --line-buffered -i error' },
      { title: { zh: '同时跟踪多个微服务的日志输出', en: 'Follow multiple log files at once' }, cmd: 'tail -f /var/log/nginx/access.log /var/log/nginx/error.log' },
    ],
  },
  {
    id: 'cmd-head',
    name: 'head',
    group: 'text',
    starsKey: 'stars4',
    package: 'coreutils',
    description: { zh: '快速预览大文件头部若干行或前 N 字节内容', en: 'Preview the first lines or bytes of large files without loading all' },
    aliases: { zh: ['文件头部', '预览前几行', '前N行'], en: ['first lines', 'preview file', 'top lines'] },
    params: [
      { flag: '-n 20', desc: { zh: '显示前 20 行', en: 'Show first 20 lines' } },
      { flag: '-c 512', desc: { zh: '显示前 512 字节', en: 'Show first 512 bytes' } },
    ],
    examples: [
      { title: { zh: '快速查看超大 CSV 文件的表头与前 5 行样本', en: 'Inspect header and first 5 rows of huge CSV' }, cmd: 'head -n 6 large-dataset.csv' },
      { title: { zh: '配合管道截取排序结果前 10 名', en: 'Take top 10 entries from sorted output' }, cmd: 'du -sh * | sort -hr | head -n 10' },
    ],
  },
  {
    id: 'cmd-sort',
    name: 'sort',
    group: 'text',
    starsKey: 'stars4',
    package: 'coreutils',
    description: { zh: '按字典序、数值、文件体积或指定列对文本行排序', en: 'Sort lines alphabetically, numerically, by human size, or by column' },
    aliases: { zh: ['排序', '按列排序', '去重排序'], en: ['sort lines', 'numeric sort', 'column sort'] },
    params: [
      { flag: '-n / -h', desc: { zh: '按数值 / 人类可读体积（K/M/G）排序', en: 'Sort numerically or by human-readable size' } },
      { flag: '-r', desc: { zh: '降序排列', en: 'Reverse sort order' } },
      { flag: '-k 2', desc: { zh: '按第 2 列作为排序键', en: 'Sort by column 2' } },
      { flag: '-u', desc: { zh: '排序同时去重', en: 'Unique lines only' } },
    ],
    examples: [
      { title: { zh: '按逗号分隔的第 3 列数值降序排列 CSV', en: 'Sort CSV descending by 3rd numeric column' }, cmd: 'sort -t "," -k 3,3nr metrics.csv' },
      { title: { zh: '对 IP 列表排序并去重', en: 'Sort and deduplicate IP list' }, cmd: 'sort -u ips.txt > unique_ips.txt' },
    ],
  },
  {
    id: 'cmd-uniq',
    name: 'uniq',
    group: 'text',
    starsKey: 'stars4',
    package: 'coreutils',
    description: { zh: '合并相邻重复行并统计各条目出现频次', en: 'Filter adjacent duplicate lines and count occurrence frequency' },
    aliases: { zh: ['去重', '频次统计', '重复行'], en: ['deduplicate', 'frequency count', 'duplicates'] },
    params: [
      { flag: '-c', desc: { zh: '在每行前显示重复出现次数', en: 'Prefix lines with occurrence count' } },
      { flag: '-d', desc: { zh: '仅输出存在重复的行', en: 'Print only duplicated lines' } },
    ],
    examples: [
      { title: { zh: '统计日志中各 HTTP 状态码出现次数排行', en: 'Rank HTTP status codes by frequency' }, cmd: "awk '{print $9}' access.log | sort | uniq -c | sort -nr" },
      { title: { zh: '找出文件中所有重复出现的配置键', en: 'Find duplicate entries in a sorted file' }, cmd: 'sort keys.txt | uniq -d' },
    ],
  },
  {
    id: 'cmd-wc',
    name: 'wc',
    group: 'text',
    starsKey: 'stars4',
    package: 'coreutils',
    description: { zh: '统计文件或标准输入的行数、词数与字节数', en: 'Count lines, words, and bytes in files or standard input' },
    aliases: { zh: ['统计行数', '字数统计', '行数'], en: ['line count', 'word count', 'count lines'] },
    params: [
      { flag: '-l', desc: { zh: '仅统计行数', en: 'Print line count only' } },
      { flag: '-c', desc: { zh: '仅统计字节数', en: 'Print byte count only' } },
    ],
    examples: [
      { title: { zh: '统计错误日志中出现 502 的总次数', en: 'Count total 502 occurrences in log' }, cmd: 'grep -F " 502 " access.log | wc -l' },
      { title: { zh: '统计当前目录所有 TypeScript 文件总行数', en: 'Count total lines across TypeScript files' }, cmd: 'find src -name "*.ts" | xargs wc -l' },
    ],
  },
  {
    id: 'cmd-cut',
    name: 'cut',
    group: 'text',
    starsKey: 'stars4',
    package: 'coreutils',
    description: { zh: '按分隔符或字符位置快速切取文本指定列', en: 'Extract specific columns or character ranges from each line' },
    aliases: { zh: ['切列', '提取列', '分割字段'], en: ['slice columns', 'extract fields', 'delimiter'] },
    params: [
      { flag: '-d ","', desc: { zh: '指定单字符列分隔符', en: 'Use single-character field delimiter' } },
      { flag: '-f 1,3', desc: { zh: '提取第 1 和第 3 列', en: 'Select fields 1 and 3' } },
    ],
    examples: [
      { title: { zh: '从 /etc/passwd 提取所有系统用户名', en: 'Extract usernames from /etc/passwd' }, cmd: 'cut -d ":" -f 1 /etc/passwd' },
      { title: { zh: '提取 CSV 文件的第 1 和第 4 列', en: 'Extract columns 1 and 4 from CSV' }, cmd: 'cut -d "," -f 1,4 report.csv' },
    ],
  },
  {
    id: 'cmd-diff',
    name: 'diff',
    group: 'file',
    starsKey: 'stars4',
    package: 'diffutils',
    description: { zh: '逐行对比两个文件或目录的差异并生成补丁', en: 'Compare files or directories line by line and generate unified patches' },
    aliases: { zh: ['文件对比', '比较差异', '补丁'], en: ['compare files', 'patch', 'differences'] },
    params: [
      { flag: '-u', desc: { zh: '输出更易读的 Unified 差异格式', en: 'Output unified diff format' } },
      { flag: '-r', desc: { zh: '递归对比两个目录', en: 'Recursively compare directories' } },
      { flag: '-w', desc: { zh: '忽略所有空白字符差异', en: 'Ignore all whitespace differences' } },
    ],
    examples: [
      { title: { zh: '对比生产与测试环境 Nginx 配置差异', en: 'Compare prod and staging Nginx configs' }, cmd: 'diff -u nginx.prod.conf nginx.staging.conf' },
      { title: { zh: '递归列出两个目录的文件差异摘要', en: 'Summarize differences between two directories' }, cmd: 'diff -rq ./dirA ./dirB' },
    ],
  },
  {
    id: 'cmd-ln',
    name: 'ln',
    group: 'file',
    starsKey: 'stars4',
    package: 'coreutils',
    description: { zh: '创建软链接（符号链接）或硬链接，常用于版本切换', en: 'Create symbolic or hard links, commonly used for atomic release switching' },
    aliases: { zh: ['软链接', '符号链接', '硬链接'], en: ['symlink', 'symbolic link', 'hard link'] },
    params: [
      { flag: '-s', desc: { zh: '创建符号链接（软链接）', en: 'Create symbolic link' } },
      { flag: '-f', desc: { zh: '强制覆盖已存在的链接', en: 'Force overwrite existing destination' } },
      { flag: '-n', desc: { zh: '目标为目录软链时不解引用', en: 'Treat symlink to directory as normal file' } },
    ],
    examples: [
      { title: { zh: '原子切换当前发布版本软链接', en: 'Atomically update current release symlink' }, cmd: 'ln -sfn /opt/releases/v2.1.0 /opt/app/current' },
      { title: { zh: '将 Nginx 站点配置软链到 sites-enabled', en: 'Enable Nginx site config via symlink' }, cmd: 'sudo ln -s /etc/nginx/sites-available/app.conf /etc/nginx/sites-enabled/' },
    ],
  },
  {
    id: 'cmd-cp',
    name: 'cp',
    group: 'file',
    starsKey: 'stars4',
    package: 'coreutils',
    description: { zh: '复制文件或目录并保留权限、时间戳与链接属性', en: 'Copy files or directories while preserving attributes and timestamps' },
    aliases: { zh: ['复制文件', '备份文件', '拷贝目录'], en: ['copy file', 'backup file', 'copy folder'] },
    params: [
      { flag: '-a', desc: { zh: '归档复制（递归且保留所有元数据）', en: 'Archive copy preserving all attributes' } },
      { flag: '-r', desc: { zh: '递归复制目录', en: 'Copy directories recursively' } },
      { flag: '-i', desc: { zh: '覆盖前交互确认', en: 'Prompt before overwrite' } },
    ],
    examples: [
      { title: { zh: '修改线上配置前快速备份原文件', en: 'Back up config file before editing' }, cmd: 'cp -a /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak' },
      { title: { zh: '完整拷贝目录并保留权限和软链', en: 'Copy directory preserving permissions and symlinks' }, cmd: 'cp -a ./dist /var/www/app' },
    ],
  },
  {
    id: 'cmd-mv',
    name: 'mv',
    group: 'file',
    starsKey: 'stars4',
    package: 'coreutils',
    description: { zh: '移动或重命名文件与目录（同分区内为 O(1) 原子操作）', en: 'Move or rename files and directories atomically within the same filesystem' },
    aliases: { zh: ['移动文件', '重命名', '改名'], en: ['move file', 'rename', 'relocate'] },
    params: [
      { flag: '-i', desc: { zh: '目标存在时提示确认', en: 'Prompt before overwriting existing target' } },
      { flag: '-n', desc: { zh: '不覆盖已存在文件', en: 'Do not overwrite existing files' } },
    ],
    examples: [
      { title: { zh: '重命名配置文件并防止误覆盖', en: 'Rename file without overwriting existing target' }, cmd: 'mv -n config.example.yml config.yml' },
      { title: { zh: '将构建产物归档到发布目录', en: 'Move build artifacts into release folder' }, cmd: 'mv ./dist /opt/releases/v2.0.0' },
    ],
  },
  {
    id: 'cmd-top',
    name: 'top / htop',
    group: 'system',
    starsKey: 'stars5',
    package: 'procps',
    description: { zh: '实时监控系统负载、CPU 核占比、内存与高耗资源进程', en: 'Interactive real-time monitor for load average, CPU, memory, and tasks' },
    aliases: { zh: ['系统监控', 'cpu飙高', '负载排查', '内存监控'], en: ['system monitor', 'high cpu', 'load average'] },
    params: [
      { flag: '-H -p <pid>', desc: { zh: '查看指定进程内部各个线程的 CPU 占用', en: 'Inspect per-thread CPU usage for a PID' } },
      { flag: '-b -n 1', desc: { zh: '批处理模式输出一次快照（便于脚本采集）', en: 'Batch mode single snapshot for scripts' } },
    ],
    examples: [
      { title: { zh: '排查某个 Java/Go 进程内哪条线程打满 CPU', en: 'Inspect hot threads inside a specific PID' }, cmd: 'top -H -p <PID>' },
      { title: { zh: '非交互模式抓取当前系统负载与前 15 行进程', en: 'Capture non-interactive top snapshot' }, cmd: 'top -b -n 1 | head -n 22' },
    ],
  },
  {
    id: 'cmd-free',
    name: 'free',
    group: 'system',
    starsKey: 'stars5',
    package: 'procps',
    description: { zh: '查看物理内存、Swap 交换分区与内核页面缓存使用量', en: 'Display physical memory, swap space, and kernel page cache usage' },
    aliases: { zh: ['内存查看', '剩余内存', 'swap', 'oom排查'], en: ['memory usage', 'ram', 'swap'] },
    params: [
      { flag: '-h', desc: { zh: '以人类可读单位（Gi/Mi）展示', en: 'Human-readable output units' } },
      { flag: '-s 2', desc: { zh: '每隔 2 秒持续刷新一次', en: 'Refresh continuously every 2 seconds' } },
    ],
    examples: [
      { title: { zh: '查看当前可用内存（重点看 available 列）', en: 'Check available memory in human units' }, cmd: 'free -h' },
      { title: { zh: '压测期间每 2 秒监控一次内存水位', en: 'Watch memory every 2 seconds during load test' }, cmd: 'free -h -s 2' },
    ],
  },
  {
    id: 'cmd-uptime',
    name: 'uptime',
    group: 'system',
    starsKey: 'stars4',
    package: 'procps',
    description: { zh: '快速查看服务器运行时长与 1/5/15 分钟平均负载', en: 'Show host uptime and 1, 5, and 15 minute load averages' },
    aliases: { zh: ['系统负载', '运行时间', 'load average'], en: ['load average', 'host uptime', 'system load'] },
    params: [
      { flag: '-p', desc: { zh: '以易读格式仅显示运行时长', en: 'Pretty-print uptime duration only' } },
      { flag: '-s', desc: { zh: '显示系统上次启动的精确时间', en: 'Show exact system boot timestamp' } },
    ],
    examples: [
      { title: { zh: '查看 1/5/15 分钟系统平均负载', en: 'Inspect 1/5/15-minute load averages' }, cmd: 'uptime' },
      { title: { zh: '结合核数判断负载是否过载', en: 'Check load alongside CPU core count' }, cmd: 'uptime && nproc' },
    ],
  },
  {
    id: 'cmd-crontab',
    name: 'crontab',
    group: 'system',
    starsKey: 'stars4',
    package: 'cron',
    description: { zh: '管理当前用户的定时任务计划表', en: 'Manage per-user scheduled cron jobs' },
    aliases: { zh: ['定时任务', '计划任务', 'cron'], en: ['scheduled jobs', 'cron table', 'timer'] },
    params: [
      { flag: '-l', desc: { zh: '列出当前用户的全部定时任务', en: 'List current user cron jobs' } },
      { flag: '-e', desc: { zh: '编辑当前用户的定时任务表', en: 'Edit current user cron jobs' } },
    ],
    examples: [
      { title: { zh: '查看当前生效的所有定时任务', en: 'List active cron jobs' }, cmd: 'crontab -l' },
      { title: { zh: '编辑定时任务（每天凌晨 3 点备份并记录日志）', en: 'Edit cron table' }, cmd: 'crontab -e' },
    ],
  },
  {
    id: 'cmd-dig',
    name: 'dig',
    group: 'net',
    starsKey: 'stars5',
    package: 'dnsutils',
    description: { zh: '专业 DNS 解析诊断工具，可查 A/AAAA/CNAME/TXT/MX 与权威链路', en: 'DNS lookup utility for A, AAAA, CNAME, TXT, MX records and delegation traces' },
    aliases: { zh: ['域名解析', 'dns排查', 'cname', 'txt记录'], en: ['dns lookup', 'cname', 'txt record', 'nslookup'] },
    params: [
      { flag: '+short', desc: { zh: '仅输出简洁解析结果', en: 'Print concise answer only' } },
      { flag: '@8.8.8.8', desc: { zh: '指定上游 DNS 服务器查询', en: 'Query a specific DNS resolver' } },
      { flag: '+trace', desc: { zh: '从根域逐级追踪完整解析链路', en: 'Trace delegation path from root servers' } },
    ],
    examples: [
      { title: { zh: '通过公共 DNS 快速查询域名解析 IP', en: 'Query A record via 1.1.1.1' }, cmd: 'dig @1.1.1.1 +short example.com A' },
      { title: { zh: '核验域名 HTTPS/邮箱 SPF 的 TXT 记录', en: 'Inspect TXT records for domain verification' }, cmd: 'dig +short example.com TXT' },
    ],
  },
  {
    id: 'cmd-nc',
    name: 'nc (netcat)',
    group: 'net',
    starsKey: 'stars5',
    package: 'netcat-openbsd',
    description: { zh: '网络探测瑞士军刀，快速测试远端 TCP/UDP 端口连通性', en: 'Networking utility for probing remote TCP/UDP port reachability' },
    aliases: { zh: ['端口连通性', 'telnet替代', '测端口', 'netcat'], en: ['port check', 'tcp probe', 'netcat', 'telnet'] },
    params: [
      { flag: '-z', desc: { zh: '零 I/O 端口扫描模式（只测连通不发数据）', en: 'Zero-I/O scan mode for connectivity check' } },
      { flag: '-v', desc: { zh: '输出详细连接结果', en: 'Verbose output' } },
      { flag: '-w 3', desc: { zh: '设置 3 秒连接超时', en: 'Set 3-second connection timeout' } },
    ],
    examples: [
      { title: { zh: '测试远端 MySQL 3306 端口防火墙是否放通', en: 'Test if remote MySQL port 3306 is reachable' }, cmd: 'nc -zv -w 3 10.0.0.10 3306' },
      { title: { zh: '批量探测 80 与 443 端口连通性', en: 'Probe ports 80 and 443' }, cmd: 'nc -zv -w 2 example.com 80 443' },
    ],
  },
  {
    id: 'cmd-tcpdump',
    name: 'tcpdump',
    group: 'net',
    starsKey: 'stars4',
    package: 'tcpdump',
    description: { zh: '命令行底层网络抓包工具，排查丢包、RST 重置与握手超时', en: 'Low-level packet sniffer for diagnosing drops, TCP RSTs, and handshakes' },
    aliases: { zh: ['抓包', '网络丢包', 'wireshark', 'pcap'], en: ['packet capture', 'sniffer', 'pcap'] },
    params: [
      { flag: '-i any', desc: { zh: '监听所有网卡流量', en: 'Capture on all network interfaces' } },
      { flag: '-nn', desc: { zh: '禁用域名与端口名称反向解析', en: 'Disable hostname and port name resolution' } },
      { flag: '-w out.pcap', desc: { zh: '保存原始报文供 Wireshark 分析', en: 'Write raw packets to pcap file' } },
    ],
    examples: [
      { title: { zh: '抓取指定端口前 100 个包并存为 pcap 文件', en: 'Capture 100 packets on port 443 to pcap' }, cmd: 'sudo tcpdump -i any -nn -c 100 port 443 -w capture.pcap' },
      { title: { zh: '实时观察与指定主机通信的 TCP 握手与复位包', en: 'Watch TCP traffic to a specific host' }, cmd: 'sudo tcpdump -i any -nn host 10.0.0.10 and tcp' },
    ],
  },
  {
    id: 'cmd-openssl',
    name: 'openssl',
    group: 'security',
    starsKey: 'stars5',
    package: 'openssl',
    description: { zh: '检查 HTTPS 证书有效期、链完整性与生成随机密钥', en: 'Inspect TLS certificates, verify chains, and generate random secrets' },
    aliases: { zh: ['证书过期', 'ssl检查', '随机密钥', 'tls'], en: ['ssl cert', 'tls check', 'random secret', 'x509'] },
    params: [
      { flag: 's_client', desc: { zh: '建立 TLS 客户端连接探测远端证书', en: 'Connect as TLS client to inspect server cert' } },
      { flag: 'x509 -noout -dates', desc: { zh: '仅打印证书生效与过期时间', en: 'Print certificate start and expiry dates' } },
      { flag: 'rand -hex 32', desc: { zh: '生成 32 字节密码学安全随机十六进制串', en: 'Generate 32-byte cryptographically secure hex secret' } },
    ],
    examples: [
      { title: { zh: '在线查看域名 HTTPS 证书颁发者与过期日期', en: 'Check remote HTTPS certificate expiry date' }, cmd: 'echo | openssl s_client -servername example.com -connect example.com:443 2>/dev/null | openssl x509 -noout -issuer -dates' },
      { title: { zh: '生成 256 位高强度随机密钥（JWT/Session Secret）', en: 'Generate a 256-bit random hex secret' }, cmd: 'openssl rand -hex 32' },
    ],
  },
]

export const EXTRA_HTTP_SPECS: readonly ExtraHttpSpec[] = [
  {
    code: 100, phrase: 'Continue', rfc: 'RFC 9110 §15.2.1', isRetryable: true,
    meaning: { zh: '服务端已收到请求头，通知客户端可继续发送大请求体', en: 'Server received request headers; client may proceed sending body' },
    causes: [{ zh: '客户端上传大文件时携带了 Expect: 100-continue 请求头', en: 'Client sent Expect: 100-continue before uploading a large payload' }],
    troubleshooting: [{ step: { zh: '检查代理透传', en: 'Check proxy handling' }, action: { zh: '若上传大文件首包延迟 1s，确认 curl 或网关是否等待 100 响应超时', en: 'If uploads stall 1s, check Expect: 100-continue handling in proxy' } }],
    architectureNotes: { zh: '用于在发送超大 Body 前先校验鉴权或 Content-Length，避免浪费上行带宽。', en: 'Lets servers reject oversized or unauthorized uploads before the body is transmitted.' },
  },
  {
    code: 101, phrase: 'Switching Protocols', rfc: 'RFC 9110 §15.2.2', isRetryable: false,
    meaning: { zh: '服务端同意按 Upgrade 请求头切换通信协议（如 WebSocket）', en: 'Server agrees to switch protocols per Upgrade header (e.g. WebSocket)' },
    causes: [{ zh: '前端发起 WebSocket 握手，携带 Upgrade: websocket 与 Connection: Upgrade', en: 'Client initiated WebSocket handshake with Upgrade headers' }],
    troubleshooting: [{ step: { zh: '核对 Nginx 透传头', en: 'Verify Nginx upgrade headers' }, action: { zh: '若 WebSocket 握手返回 200/400 而非 101，补齐 proxy_http_version 1.1 与 Upgrade 头', en: 'Ensure proxy_http_version 1.1 and Upgrade/Connection headers are forwarded' } }],
    architectureNotes: { zh: '长连接网关需单独调大 proxy_read_timeout 并实现心跳保活。', en: 'Long-lived upgraded connections need heartbeat pings and extended proxy timeouts.' },
  },
  {
    code: 102, phrase: 'Processing', rfc: 'RFC 2518 §10.1', isRetryable: false,
    meaning: { zh: 'WebDAV 扩展：服务端已受理耗时请求但尚未产生最终响应', en: 'WebDAV: server accepted a long-running request and is still processing' },
    causes: [{ zh: 'WebDAV 批量目录操作耗时较长，服务端先回中间态防超时', en: 'Long WebDAV batch operation sending interim status to prevent timeout' }],
    troubleshooting: [{ step: { zh: '改为异步任务', en: 'Prefer async jobs' }, action: { zh: '现代 REST API 应优先采用 202 + 轮询或 SSE 流式推送', en: 'Modern APIs should prefer 202 Accepted with polling or SSE' } }],
    architectureNotes: { zh: '仅在 WebDAV 场景使用，常规浏览器 HTTP 客户端较少直接消费。', en: 'Mainly used by WebDAV clients; rarely consumed by standard web browsers.' },
  },
  {
    code: 201, phrase: 'Created', rfc: 'RFC 9110 §15.3.2', isRetryable: false,
    meaning: { zh: '请求成功并在服务端创建了新资源', en: 'Request succeeded and created a new resource on the server' },
    causes: [{ zh: 'POST 创建订单/用户或 PUT 新建对象成功', en: 'POST/PUT successfully persisted a new entity' }],
    troubleshooting: [{ step: { zh: '检查 Location 头与响应体', en: 'Check Location header' }, action: { zh: '确认客户端能正确识别 2xx（而不仅硬编码判断 === 200）', en: 'Ensure frontend accepts all 2xx statuses rather than checking === 200 only' } }],
    architectureNotes: { zh: '规范做法是在响应头附带 Location 指向新资源 URI 并返回新对象 ID。', en: 'Include a Location header pointing to the newly created resource URI.' },
  },
  {
    code: 202, phrase: 'Accepted', rfc: 'RFC 9110 §15.3.3', isRetryable: false,
    meaning: { zh: '请求已接收并进入异步队列，尚未执行完毕', en: 'Request accepted for asynchronous processing; not yet completed' },
    causes: [{ zh: '报表导出、视频转码、AI 生成等长任务已投递队列', en: 'Long-running export, transcoding, or AI job queued' }],
    troubleshooting: [{ step: { zh: '轮询任务状态接口', en: 'Poll job status' }, action: { zh: '使用响应返回的 taskId 定时轮询或订阅回调通知', en: 'Use returned taskId to poll status endpoint or await webhook' } }],
    architectureNotes: { zh: '异步削峰标准状态码，避免同步阻塞触发网关 504。', en: 'Standard async pattern to avoid synchronous gateway timeouts.' },
  },
  {
    code: 204, phrase: 'No Content', rfc: 'RFC 9110 §15.3.5', isRetryable: true,
    meaning: { zh: '请求处理成功，但响应体为空无需返回内容', en: 'Request succeeded with intentionally empty response body' },
    causes: [{ zh: 'DELETE 删除资源成功、PUT 更新成功或 CORS 预检 OPTIONS 通过', en: 'Successful DELETE/PUT or CORS preflight OPTIONS response' }],
    troubleshooting: [{ step: { zh: '避免空体 JSON.parse 报错', en: 'Guard JSON.parse on empty body' }, action: { zh: '前端 fetch 遇到 204 时不要直接调用 res.json()，否则会抛 SyntaxError', en: 'Skip res.json() on 204 responses to avoid unexpected end of JSON errors' } }],
    architectureNotes: { zh: '规范要求 204 响应绝不能包含消息体。', en: 'RFC forbids including any message body in a 204 response.' },
  },
  {
    code: 206, phrase: 'Partial Content', rfc: 'RFC 9110 §15.3.7', isRetryable: true,
    meaning: { zh: '服务端按 Range 请求头返回了资源的部分字节区间', en: 'Server returned the requested byte range per Range header' },
    causes: [{ zh: '视频拖拽播放、大文件分片下载或断点续传', en: 'Video seeking, chunked download, or resumable transfer' }],
    troubleshooting: [{ step: { zh: '检查 Content-Range 与 CORS', en: 'Verify Content-Range & CORS' }, action: { zh: '跨域播放器需在 Access-Control-Expose-Headers 中暴露 Content-Range 与 Accept-Ranges', en: 'Expose Content-Range and Accept-Ranges in CORS headers for media players' } }],
    architectureNotes: { zh: 'CDN 分片缓存依赖 206 与 Accept-Ranges: bytes 协同。', en: 'CDN range caching relies on Accept-Ranges: bytes and Content-Range.' },
  },
  {
    code: 302, phrase: 'Found', rfc: 'RFC 9110 §15.4.3', isRetryable: false,
    meaning: { zh: '临时重定向，资源暂时位于新的 URI（不持久缓存）', en: 'Temporary redirect; resource currently resides at another URI' },
    causes: [{ zh: '未登录跳转 SSO 登录页、活动页临时分流', en: 'Redirecting unauthenticated users to SSO login or campaign page' }],
    troubleshooting: [{ step: { zh: '排查重定向死循环', en: 'Check redirect loops' }, action: { zh: '若浏览器报 ERR_TOO_MANY_REDIRECTS，检查登录态 Cookie 的 SameSite/Domain 设置', en: 'On redirect loops, inspect session cookie Domain, Secure, and SameSite attributes' } }],
    architectureNotes: { zh: '与 301 类似，浏览器常把 POST 改为 GET；需保留方法请改用 307。', en: 'Browsers often change POST to GET; use 307 when method preservation is required.' },
  },
  {
    code: 303, phrase: 'See Other', rfc: 'RFC 9110 §15.4.4', isRetryable: true,
    meaning: { zh: '明确指示客户端使用 GET 方法跳转至另一个结果页', en: 'Explicitly directs client to retrieve the target URI using GET' },
    causes: [{ zh: 'POST 表单提交后跳转到结果页（PRG 防重复提交模式）', en: 'Post/Redirect/Get pattern after form submission' }],
    troubleshooting: [{ step: { zh: '核对 Location 目标地址', en: 'Verify Location target' }, action: { zh: '确保跳转目标页支持 GET 访问且不依赖原 POST 载荷', en: 'Ensure target URI handles GET without needing original POST body' } }],
    architectureNotes: { zh: '经典的 Post/Redirect/Get 模式可有效防止用户刷新页面重复下单。', en: 'Prevents duplicate form submissions when users refresh the confirmation page.' },
  },
  {
    code: 307, phrase: 'Temporary Redirect', rfc: 'RFC 9110 §15.4.8', isRetryable: false,
    meaning: { zh: '临时重定向，且强制要求保留原 HTTP 方法与请求体', en: 'Temporary redirect that strictly preserves HTTP method and body' },
    causes: [{ zh: '网关灰度切流、浏览器 HSTS 内部强制 HTTPS 跳转', en: 'Canary routing or browser internal HSTS upgrade' }],
    troubleshooting: [{ step: { zh: '区分服务端 307 与浏览器 HSTS', en: 'Distinguish server vs HSTS 307' }, action: { zh: 'DevTools 显示 Internal Redirect 时是本地 HSTS 触发，无需排查后端', en: 'DevTools "Internal Redirect" comes from browser HSTS cache, not backend' } }],
    architectureNotes: { zh: 'POST/PUT 接口需要临时转发时首选 307，避免 302 丢请求体。', en: 'Preferred over 302 for redirecting POST/PUT API calls safely.' },
  },
  {
    code: 308, phrase: 'Permanent Redirect', rfc: 'RFC 9110 §15.4.9', isRetryable: false,
    meaning: { zh: '永久重定向，且强制要求保留原 HTTP 方法与请求体', en: 'Permanent redirect that strictly preserves HTTP method and body' },
    causes: [{ zh: 'API 域名永久迁移、Webhook 地址升级', en: 'Permanent API host migration or webhook endpoint upgrade' }],
    troubleshooting: [{ step: { zh: '清理持久缓存', en: 'Clear cached redirect' }, action: { zh: '与 301 一样会被客户端长期缓存，上线前务必核实目标路径', en: 'Aggressively cached like 301; validate target URL before rollout' } }],
    architectureNotes: { zh: 'POST 接口做永久迁移时应使用 308 替代 301。', en: 'Use 308 instead of 301 when permanently moving non-GET endpoints.' },
  },
  {
    code: 402, phrase: 'Payment Required', rfc: 'RFC 9110 §15.5.3', isRetryable: false,
    meaning: { zh: '账户余额不足、配额耗尽或需要付费订阅才能继续调用', en: 'Insufficient balance, quota exhausted, or paid plan required' },
    causes: [{ zh: 'AI/云服务 API Key 欠费或超出免费额度', en: 'API billing account exhausted or subscription inactive' }],
    troubleshooting: [{ step: { zh: '核对账单与配额', en: 'Check billing & quota' }, action: { zh: '登录控制台检查余额、Token 限额及支付方式状态', en: 'Inspect billing dashboard, credit balance, and spending limits' } }],
    architectureNotes: { zh: '客户端遇到 402 应立即停止重试并向用户展示清晰的充值引导。', en: 'Halt retries immediately and surface an actionable billing prompt.' },
  },
  {
    code: 405, phrase: 'Method Not Allowed', rfc: 'RFC 9110 §15.5.6', isRetryable: false,
    meaning: { zh: '路由存在但不支持当前使用的 HTTP 请求方法', en: 'Endpoint exists but does not support the used HTTP method' },
    causes: [{ zh: '用 GET 请求了只允许 POST 的接口，或向静态站点发送 POST', en: 'Sent GET to a POST-only route or POST to a static file server' }],
    troubleshooting: [{ step: { zh: '查看 Allow 响应头', en: 'Inspect Allow header' }, action: { zh: '对照接口文档与响应 Allow 头，修正客户端请求方法或网关重写规则', en: 'Check Allow header and route table to match the expected HTTP verb' } }],
    architectureNotes: { zh: '服务端返回 405 时按规范必须附带 Allow 头列举允许的方法。', en: 'Servers must include an Allow header listing supported methods.' },
  },
  {
    code: 406, phrase: 'Not Acceptable', rfc: 'RFC 9110 §15.5.7', isRetryable: false,
    meaning: { zh: '服务端无法生成符合客户端 Accept 请求头协商格式的内容', en: 'Server cannot produce a response matching client Accept headers' },
    causes: [{ zh: '客户端要求 Accept: application/xml 而接口仅提供 JSON', en: 'Client requested unsupported media type in Accept header' }],
    troubleshooting: [{ step: { zh: '检查 Accept 请求头', en: 'Check Accept header' }, action: { zh: '将 Accept 调整为 application/json 或 */* 后重试', en: 'Set Accept to application/json or */* and retest' } }],
    architectureNotes: { zh: 'Spring MVC 缺少对应 HttpMessageConverter 时也常触发 406。', en: 'Often caused by missing serializer/converter for requested media type.' },
  },
  {
    code: 408, phrase: 'Request Timeout', rfc: 'RFC 9110 §15.5.9', isRetryable: true,
    meaning: { zh: '服务端等待客户端发送完整请求超时，主动关闭连接', en: 'Server timed out waiting for the client to finish sending the request' },
    causes: [{ zh: '弱网环境上传卡顿，或 Keep-Alive 空闲连接超时被服务端回收', en: 'Slow mobile upload or idle keep-alive socket closed by server' }],
    troubleshooting: [{ step: { zh: '核对 Keep-Alive 超时', en: 'Align keep-alive timeouts' }, action: { zh: '确保客户端连接池空闲超时略小于网关 keepalive_timeout', en: 'Keep client idle pool timeout shorter than server keepalive_timeout' } }],
    architectureNotes: { zh: '幂等请求遇到 408 可新建连接安全重试。', en: 'Idempotent requests may safely retry on a fresh TCP connection.' },
  },
  {
    code: 409, phrase: 'Conflict', rfc: 'RFC 9110 §15.5.10', isRetryable: false,
    meaning: { zh: '请求与目标资源当前状态冲突（如唯一键重复或乐观锁版本过期）', en: 'Request conflicts with current resource state (duplicate key or stale version)' },
    causes: [{ zh: '注册已存在的邮箱/用户名，或并发编辑提交了过期的 ETag/version', en: 'Duplicate unique constraint or stale optimistic lock version' }],
    troubleshooting: [{ step: { zh: '拉取最新状态再提交', en: 'Reload latest state' }, action: { zh: '前端提示用户刷新最新数据或合并差异后重新提交', en: 'Fetch latest version/ETag and resolve conflict before resubmitting' } }],
    architectureNotes: { zh: '并发写接口推荐配合 If-Match / version 字段返回 409 或 412。', en: 'Use optimistic locking with version numbers or ETags to guard concurrent writes.' },
  },
  {
    code: 410, phrase: 'Gone', rfc: 'RFC 9110 §15.5.11', isRetryable: false,
    meaning: { zh: '目标资源已被永久下线删除，且不再提供转发地址', en: 'Resource was permanently removed and is no longer available' },
    causes: [{ zh: '旧版 API 彻底退役、一次性分享链接已销毁', en: 'Retired legacy API version or expired one-time link' }],
    troubleshooting: [{ step: { zh: '升级客户端接口版本', en: 'Upgrade endpoint' }, action: { zh: '切换至新版 API 路径并移除本地失效书签/缓存', en: 'Migrate callers to replacement API and purge stale references' } }],
    architectureNotes: { zh: '相比 404，410 明确告知搜索引擎和客户端不必再定期重试抓回。', en: 'Signals crawlers and clients to purge the URL permanently unlike 404.' },
  },
  {
    code: 412, phrase: 'Precondition Failed', rfc: 'RFC 9110 §15.5.13', isRetryable: false,
    meaning: { zh: '请求头中的条件断言（如 If-Match / If-Unmodified-Since）未满足', en: 'Conditional request header (If-Match / If-Unmodified-Since) evaluated false' },
    causes: [{ zh: '对象存储或文档协同写入时，远端 ETag 已被他人更新', en: 'Remote ETag changed before conditional update arrived' }],
    troubleshooting: [{ step: { zh: '重新获取最新 ETag', en: 'Refresh ETag' }, action: { zh: '先 GET 拉取最新版本与 ETag，合并变更后再带新 If-Match 写入', en: 'GET latest resource, merge changes, and retry with updated If-Match' } }],
    architectureNotes: { zh: '实现无锁并发控制（Lost Update 防护）的标准 HTTP 机制。', en: 'Standard HTTP mechanism for preventing lost updates without server locks.' },
  },
  {
    code: 413, phrase: 'Content Too Large', rfc: 'RFC 9110 §15.5.14', isRetryable: false,
    meaning: { zh: '请求体体积超出网关或服务端允许的最大限制', en: 'Request payload exceeds server or proxy maximum size limit' },
    causes: [{ zh: '上传大文件超过 Nginx client_max_body_size（默认仅 1MB）', en: 'Upload exceeds Nginx client_max_body_size (default 1MB)' }],
    troubleshooting: [{ step: { zh: '调大网关上限或改分片上传', en: 'Raise limit or use chunked upload' }, action: { zh: '在 Nginx 配置 client_max_body_size 50m; 大文件建议直传对象存储', en: 'Adjust client_max_body_size or switch to presigned multipart upload' } }],
    architectureNotes: { zh: '切忌无限制放大网关内存缓冲，超过 50MB 的文件建议走直传分片。', en: 'Avoid unbounded body limits; use direct multipart uploads for large files.' },
  },
  {
    code: 414, phrase: 'URI Too Long', rfc: 'RFC 9110 §15.5.15', isRetryable: false,
    meaning: { zh: '请求 URL 长度超过服务器或代理允许上限', en: 'Request URI exceeds server or proxy maximum length' },
    causes: [{ zh: '在 GET Query 参数里拼接了数百个 ID 或整段 Base64 数据', en: 'Hundreds of IDs or Base64 blobs stuffed into GET query string' }],
    troubleshooting: [{ step: { zh: '改用 POST Body 传参', en: 'Move payload to POST body' }, action: { zh: '批量查询接口改为 POST + JSON Body，避免依赖超长 URL', en: 'Convert bulk-query endpoints to POST with JSON request body' } }],
    architectureNotes: { zh: '多数网关与浏览器建议将 URL 严格控制在 2KB~8KB 以内。', en: 'Keep URLs under 2KB-8KB for cross-proxy and browser compatibility.' },
  },
  {
    code: 415, phrase: 'Unsupported Media Type', rfc: 'RFC 9110 §15.5.16', isRetryable: false,
    meaning: { zh: '请求头 Content-Type 指定的媒体格式不被该接口支持', en: 'Request Content-Type media format is not supported by this endpoint' },
    causes: [{ zh: '发送了 JSON 字符串但漏写 Content-Type: application/json（默认成 text/plain）', en: 'Sent JSON body without Content-Type: application/json header' }],
    troubleshooting: [{ step: { zh: '核对 Content-Type 头', en: 'Verify Content-Type header' }, action: { zh: '按接口要求设置 application/json 或 multipart/form-data', en: 'Match expected Content-Type (application/json or multipart/form-data)' } }],
    architectureNotes: { zh: '上传 FormData 时不要手动硬编码 boundary，应交由浏览器自动生成。', en: 'Let fetch/browser auto-generate multipart boundary when sending FormData.' },
  },
  {
    code: 418, phrase: "I'm a teapot", rfc: 'RFC 2324 §2.3.2', isRetryable: false,
    meaning: { zh: '愚人节彩蛋状态码，偶见于反爬蜜罐或防滥用拦截响应', en: 'April Fools RFC easter egg; occasionally used by anti-bot traps' },
    causes: [{ zh: '触发站点反爬策略、WAF 趣味拦截或测试桩返回', en: 'Triggered anti-scraping honeypot or mock test endpoint' }],
    troubleshooting: [{ step: { zh: '检查请求特征', en: 'Inspect request headers' }, action: { zh: '核对 User-Agent、Referer 与目标接口地址是否正确', en: 'Verify User-Agent, Referer, and target endpoint URL' } }],
    architectureNotes: { zh: '正式业务接口不应使用 418 代替 403/429。', en: 'Production APIs should use standard 403/429 instead of 418.' },
  },
  {
    code: 422, phrase: 'Unprocessable Content', rfc: 'RFC 9110 §15.5.21', isRetryable: false,
    meaning: { zh: '请求语法与 JSON 结构合法，但语义或业务字段校验未通过', en: 'Syntax is valid JSON, but semantic or schema field validation failed' },
    causes: [{ zh: '邮箱格式不合法、结束时间早于开始时间、Zod/FastAPI 参数模型校验失败', en: 'Invalid email format, date range error, or Zod/Pydantic validation failure' }],
    troubleshooting: [{ step: { zh: '读取响应体字段级错误列表', en: 'Read field-level error list' }, action: { zh: '解析返回的 errors/detail 数组定位具体不合规字段并提示用户', en: 'Inspect errors/detail array in body to pinpoint invalid fields' } }],
    architectureNotes: { zh: '相比 400（语法损坏），422 更适合表达“JSON 合法但业务字段不合规”。', en: 'Distinguishes semantic validation errors from malformed 400 syntax.' },
  },
  {
    code: 426, phrase: 'Upgrade Required', rfc: 'RFC 9110 §15.5.22', isRetryable: false,
    meaning: { zh: '服务端拒绝当前协议版本，要求升级（如强制 TLS 或 HTTP/2）', en: 'Server refuses current protocol and requires upgrade (e.g. TLS/WebSocket)' },
    causes: [{ zh: '用普通 HTTP 访问了仅允许 WebSocket 或高版本 TLS 的端点', en: 'Plain HTTP request sent to WebSocket-only or newer TLS endpoint' }],
    troubleshooting: [{ step: { zh: '检查 Upgrade 响应头', en: 'Inspect Upgrade header' }, action: { zh: '按响应 Upgrade 头切换至 ws/wss 或升级客户端 TLS 库版本', en: 'Switch to required protocol (ws/wss or TLS 1.2+) per Upgrade header' } }],
    architectureNotes: { zh: '响应应附带 Upgrade 头明确指明所需的目标协议。', en: 'Response should specify required protocol(s) in the Upgrade header.' },
  },
  {
    code: 451, phrase: 'Unavailable For Legal Reasons', rfc: 'RFC 7725 §3', isRetryable: false,
    meaning: { zh: '因合规审计、版权投诉或地域法律限制无法提供该资源', en: 'Resource blocked due to legal, copyright, or regional compliance restrictions' },
    causes: [{ zh: '源站按地域 IP 屏蔽或内容因合规下架', en: 'Geo-blocked IP range or DMCA/regulatory takedown' }],
    troubleshooting: [{ step: { zh: '核对地域合规与出口 IP', en: 'Check egress region' }, action: { zh: '确认请求出口所在地区是否在服务许可范围内', en: 'Verify client egress region against service availability policy' } }],
    architectureNotes: { zh: '客户端无需自动重试，应直接呈现友好合规提示。', en: 'Do not auto-retry; display a clear availability notice.' },
  },
  {
    code: 501, phrase: 'Not Implemented', rfc: 'RFC 9110 §15.6.2', isRetryable: false,
    meaning: { zh: '服务端尚未实现处理该请求方法或特性的能力', en: 'Server does not support the functionality required to fulfill the request' },
    causes: [{ zh: '发送了服务器未识别的扩展 HTTP 方法或尚未上线的接口占位', en: 'Unrecognized HTTP method or unimplemented endpoint stub' }],
    troubleshooting: [{ step: { zh: '确认方法与接口版本', en: 'Verify verb and API version' }, action: { zh: '检查请求方法是否拼写错误，或确认后端服务版本是否已发布该能力', en: 'Check HTTP verb spelling and backend deployment version' } }],
    architectureNotes: { zh: '区别于 405（该路由不支持某已知方法），501 表示服务器全局不认识该能力。', en: 'Unlike 405 (route-level), 501 means server-wide lack of support.' },
  },
  {
    code: 505, phrase: 'HTTP Version Not Supported', rfc: 'RFC 9110 §15.6.6', isRetryable: false,
    meaning: { zh: '服务端不支持请求报文中所声明的 HTTP 协议主版本', en: 'Server does not support the HTTP protocol version used in the request' },
    causes: [{ zh: '老旧代理发送非法协议行，或手写 Socket 报文格式错误', en: 'Malformed HTTP version line from custom socket client or legacy proxy' }],
    troubleshooting: [{ step: { zh: '检查请求行协议版本', en: 'Inspect HTTP version line' }, action: { zh: '确认客户端发送标准 HTTP/1.1 或 HTTP/2，并排查中间代理改写', en: 'Ensure standard HTTP/1.1 or HTTP/2 framing without corrupt proxies' } }],
    architectureNotes: { zh: '常见于自研 TCP 客户端未正确编码 URL 空格导致请求行解析错位。', en: 'Often caused by unencoded spaces in raw request lines shifting the HTTP version token.' },
  },
]

export const EXTRA_PORT_SPECS: readonly ExtraPortSpec[] = [
  { port: 21, protocol: 'TCP', service: 'FTP', category: { zh: '文件传输', en: 'File Transfer' }, description: { zh: '文件传输协议控制通道默认端口（数据通道为 20）', en: 'File Transfer Protocol control channel (data channel uses 20)' }, securityNotice: { zh: '明文传输凭据极不安全，公网务必替换为 SFTP (22) 或 FTPS', en: 'Transmits credentials in plaintext; replace with SFTP (22) or FTPS' } },
  { port: 23, protocol: 'TCP', service: 'Telnet', category: { zh: '远程管理', en: 'Remote Admin' }, description: { zh: '传统明文远程终端协议端口', en: 'Legacy unencrypted remote terminal protocol' }, securityNotice: { zh: '严禁在生产环境开启，全部迁移至 SSH (22)', en: 'Never enable in production; migrate all remote shells to SSH (22)' } },
  { port: 25, protocol: 'TCP', service: 'SMTP', category: { zh: '邮件服务', en: 'Email' }, description: { zh: '邮件服务器间中继投递默认端口', en: 'Default mail transfer agent relay port' }, securityNotice: { zh: '多数云厂商默认封禁出站 25 防垃圾邮件，业务发信请用 465/587', en: 'Outbound 25 is commonly blocked by cloud providers; use 465/587 for submission' } },
  { port: 67, protocol: 'UDP', service: 'DHCP Server', category: { zh: '网络基础', en: 'Core Networking' }, description: { zh: '局域网动态 IP 地址分配服务端端口（客户端为 68）', en: 'Dynamic Host Configuration Protocol server port (client uses 68)' }, securityNotice: { zh: '仅限内网广播域启用，交换机开启 DHCP Snooping 防伪造网关', en: 'Restrict to internal LAN and enable DHCP Snooping on switches' } },
  { port: 110, protocol: 'TCP', service: 'POP3', category: { zh: '邮件服务', en: 'Email' }, description: { zh: '明文邮件收取协议端口', en: 'Plaintext Post Office Protocol v3 mail retrieval' }, securityNotice: { zh: '建议禁用明文 110，改用加密端口 POP3S (995) 或 IMAPS (993)', en: 'Disable plaintext 110 in favor of POP3S (995) or IMAPS (993)' } },
  { port: 123, protocol: 'UDP', service: 'NTP', category: { zh: '网络基础', en: 'Core Networking' }, description: { zh: '网络时间同步协议端口（分布式集群时钟一致性基石）', en: 'Network Time Protocol for cluster clock synchronization' }, securityNotice: { zh: '禁用 monlist 查询以防被利用发起 NTP 反射放大攻击', en: 'Disable monlist queries to prevent NTP amplification DDoS' } },
  { port: 143, protocol: 'TCP', service: 'IMAP', category: { zh: '邮件服务', en: 'Email' }, description: { zh: '交互式邮件访问协议明文/STARTTLS 端口', en: 'Internet Message Access Protocol plaintext/STARTTLS port' }, securityNotice: { zh: '强制开启 STARTTLS 或直接使用 IMAPS (993)', en: 'Require STARTTLS or switch directly to IMAPS (993)' } },
  { port: 161, protocol: 'UDP', service: 'SNMP', category: { zh: '监控运维', en: 'Monitoring' }, description: { zh: '网络设备与服务器监控轮询端口（Trap 告警为 162）', en: 'Simple Network Management Protocol polling port (Traps use 162)' }, securityNotice: { zh: '禁止使用默认 public/private 团体名，优先升级 SNMPv3 加密认证', en: 'Never use default community strings; upgrade to SNMPv3 with authPriv' } },
  { port: 389, protocol: 'TCP', service: 'LDAP', category: { zh: '身份认证', en: 'Identity' }, description: { zh: '企业统一目录服务与域控认证端口', en: 'Lightweight Directory Access Protocol enterprise directory port' }, securityNotice: { zh: '公网严禁暴露，内网通信应启用 STARTTLS 或 LDAPS (636)', en: 'Keep strictly internal and enforce STARTTLS or LDAPS (636)' } },
  { port: 465, protocol: 'TCP', service: 'SMTPS', category: { zh: '邮件服务', en: 'Email' }, description: { zh: '隐式 TLS 加密的邮件发送提交端口', en: 'Implicit TLS encrypted SMTP mail submission port' }, securityNotice: { zh: '推荐作为后端服务发信首选加密端口，妥善保管授权码', en: 'Recommended encrypted port for transactional email sending' } },
  { port: 587, protocol: 'TCP', service: 'SMTP Submission', category: { zh: '邮件服务', en: 'Email' }, description: { zh: '支持 STARTTLS 协商加密的标准邮件提交端口', en: 'Standard mail submission port with STARTTLS upgrade' }, securityNotice: { zh: '强制要求 STARTTLS 与 SPF/DKIM/DMARC 记录防伪造', en: 'Enforce STARTTLS along with SPF/DKIM/DMARC DNS records' } },
  { port: 636, protocol: 'TCP', service: 'LDAPS', category: { zh: '身份认证', en: 'Identity' }, description: { zh: '基于 TLS 加密的企业 LDAP 目录服务端口', en: 'LDAP over TLS encrypted directory service port' }, securityNotice: { zh: '校验证书有效性并仅对内网应用安全组开放', en: 'Verify TLS certificates and restrict access to internal subnets' } },
  { port: 873, protocol: 'TCP', service: 'rsync daemon', category: { zh: '文件传输', en: 'File Transfer' }, description: { zh: 'rsync 独立守护进程模块同步端口', en: 'Standalone rsync daemon file sync port' }, securityNotice: { zh: '高危预警：切勿匿名暴露可写模块，日常同步优先走 SSH 通道', en: 'Never expose anonymous writable modules; prefer rsync over SSH' } },
  { port: 993, protocol: 'TCP', service: 'IMAPS', category: { zh: '邮件服务', en: 'Email' }, description: { zh: 'TLS 加密的 IMAP 邮件收取端口', en: 'IMAP over TLS encrypted mail retrieval port' }, securityNotice: { zh: '启用强密码或 OAuth2 应用专用令牌登录', en: 'Use app-specific passwords or OAuth2 tokens' } },
  { port: 1433, protocol: 'TCP', service: 'Microsoft SQL Server', category: { zh: '关系型数据库', en: 'Relational DB' }, description: { zh: 'SQL Server 关系型数据库默认通信端口', en: 'Default port for Microsoft SQL Server database engine' }, securityNotice: { zh: '严禁暴露公网，禁用弱口令 sa 账号并启用加密连接', en: 'Never expose publicly; disable weak sa passwords and enforce TLS' } },
  { port: 1521, protocol: 'TCP', service: 'Oracle Database', category: { zh: '关系型数据库', en: 'Relational DB' }, description: { zh: 'Oracle TNS Listener 监听器默认端口', en: 'Default Oracle TNS Listener database port' }, securityNotice: { zh: '配置 sqlnet.ora IP 白名单，仅允许应用服务器子网访问', en: 'Enforce IP allowlists in sqlnet.ora for application subnets only' } },
  { port: 1883, protocol: 'TCP', service: 'MQTT', category: { zh: '物联网/消息', en: 'IoT / Messaging' }, description: { zh: '物联网轻量级发布订阅消息代理默认端口（TLS 为 8883）', en: 'Lightweight IoT publish/subscribe broker port (TLS uses 8883)' }, securityNotice: { zh: '生产物联网接入务必切换至 8883 MQTTS 并启用双向证书或鉴权', en: 'Use 8883 (MQTTS) with client auth or mTLS in production' } },
  { port: 2049, protocol: 'TCP/UDP', service: 'NFS', category: { zh: '文件存储', en: 'File Storage' }, description: { zh: 'Linux 网络文件系统共享挂载端口（NFSv4 仅需单端口）', en: 'Network File System mount port (NFSv4 uses single port)' }, securityNotice: { zh: '在 /etc/exports 中严格限定内网网段并启用 root_squash', en: 'Restrict /etc/exports to private CIDRs and keep root_squash enabled' } },
  { port: 2181, protocol: 'TCP', service: 'Apache ZooKeeper', category: { zh: '分布式协调', en: 'Coordination' }, description: { zh: 'ZooKeeper 客户端连接与分布式锁协调端口', en: 'ZooKeeper client connection and distributed coordination port' }, securityNotice: { zh: '严禁公网访问，开启 ACL 鉴权并隔离在 VPC 内网', en: 'Keep strictly inside VPC and enable ZooKeeper ACLs' } },
  { port: 2375, protocol: 'TCP', service: 'Docker Engine API', category: { zh: '容器引擎', en: 'Container Engine' }, description: { zh: 'Docker 守护进程未加密 HTTP Remote API 端口（TLS 为 2376）', en: 'Unencrypted Docker Engine HTTP API port (TLS uses 2376)' }, securityNotice: { zh: '极高危：公网暴露 2375 等于直接交出宿主机 root 权限，必须关闭或启用 2376 mTLS', en: 'Critical: exposing 2375 grants instant root takeover; disable or enforce 2376 mTLS' } },
  { port: 2379, protocol: 'TCP', service: 'etcd Client', category: { zh: '分布式协调', en: 'Coordination' }, description: { zh: 'Kubernetes 底层键值存储 etcd 客户端通信端口（节点间为 2380）', en: 'etcd client API port backing Kubernetes (peer port 2380)' }, securityNotice: { zh: '必须强制 mTLS 双向证书认证且仅允许 API Server 访问', en: 'Enforce mTLS client certificates and restrict to K8s API servers' } },
  { port: 3000, protocol: 'TCP', service: 'Grafana / Node Dev', category: { zh: '开发/监控', en: 'Dev / Monitoring' }, description: { zh: 'Grafana 监控面板及 React/Express/Next.js 本地开发默认端口', en: 'Default port for Grafana dashboards and Node/React/Next.js dev servers' }, securityNotice: { zh: 'Grafana 首次部署立即修改默认 admin 密码并前置反向代理', en: 'Change default Grafana admin password immediately and proxy via HTTPS' } },
  { port: 3389, protocol: 'TCP/UDP', service: 'RDP', category: { zh: '远程管理', en: 'Remote Admin' }, description: { zh: 'Windows 远程桌面协议默认端口', en: 'Microsoft Remote Desktop Protocol default port' }, securityNotice: { zh: '公网直接暴露极易遭勒索爆破，建议经 VPN/堡垒机访问并开启 NLA', en: 'High brute-force target; place behind VPN/bastion and enforce NLA' } },
  { port: 4000, protocol: 'TCP', service: 'TiDB / Phoenix', category: { zh: '关系型数据库', en: 'Relational DB' }, description: { zh: 'TiDB 分布式数据库兼容 MySQL 协议连接端口', en: 'TiDB distributed SQL database client port' }, securityNotice: { zh: '仅限业务内网访问，配置强口令与 TLS 传输加密', en: 'Restrict to private VPC subnets with strong auth and TLS' } },
  { port: 5000, protocol: 'TCP', service: 'Docker Registry / Flask', category: { zh: '开发/镜像仓', en: 'Dev / Registry' }, description: { zh: '私有容器镜像仓库与 Python Flask 默认开发端口', en: 'Private Docker Registry and Python Flask default port' }, securityNotice: { zh: 'macOS AirPlay 接收器默认占用 5000，本地调试冲突时可改端口', en: 'macOS AirPlay Receiver binds 5000 by default; switch port if conflicted' } },
  { port: 5173, protocol: 'TCP', service: 'Vite Dev Server', category: { zh: '前端开发', en: 'Frontend Dev' }, description: { zh: 'Vite 前端开发服务器与热更新默认端口', en: 'Default Vite development server and HMR port' }, securityNotice: { zh: '默认仅绑定 localhost，局域网联调开 --host 时注意不要暴露在公共 Wi-Fi', en: 'Binds localhost by default; avoid exposing --host on untrusted Wi-Fi' } },
  { port: 5672, protocol: 'TCP', service: 'RabbitMQ (AMQP)', category: { zh: '消息队列', en: 'Message Queue' }, description: { zh: 'RabbitMQ AMQP 协议消息收发默认端口（管理界面为 15672）', en: 'RabbitMQ AMQP broker port (Web UI uses 15672)' }, securityNotice: { zh: '删除默认 guest 账号或限制仅本机登录，内网隔离并启用 TLS (5671)', en: 'Disable default guest remote access and isolate inside VPC' } },
  { port: 6443, protocol: 'TCP', service: 'Kubernetes API Server', category: { zh: '容器编排', en: 'Orchestration' }, description: { zh: 'Kubernetes 集群控制面 kube-apiserver HTTPS 入口端口', en: 'Kubernetes control plane kube-apiserver HTTPS port' }, securityNotice: { zh: '严格限制公网源 IP 白名单，禁用匿名认证与过宽 RBAC 绑定', en: 'Restrict source IP allowlists and disable anonymous auth' } },
  { port: 8000, protocol: 'TCP', service: 'Django / FastAPI / Kong', category: { zh: '应用容器', en: 'App Container' }, description: { zh: 'Python Django/Uvicorn 开发服务及 Kong 网关默认代理端口', en: 'Common port for Django, FastAPI/Uvicorn, and Kong Gateway' }, securityNotice: { zh: '生产部署请通过 Gunicorn/Uvicorn + Nginx 反代，切勿直接用开发服务器', en: 'Serve via production ASGI/WSGI worker behind Nginx, not dev server' } },
  { port: 8443, protocol: 'TCP', service: 'HTTPS Alternate', category: { zh: 'Web 服务', en: 'Web Server' }, description: { zh: 'Tomcat/网关常用备选 HTTPS 加密端口', en: 'Alternate HTTPS port used by Tomcat, gateways, and admin panels' }, securityNotice: { zh: '配置有效 TLS 证书，管理后台入口建议叠加 IP 白名单', en: 'Configure valid TLS certificates and restrict admin panels by IP' } },
  { port: 9000, protocol: 'TCP', service: 'MinIO / PHP-FPM / ClickHouse', category: { zh: '存储/运行时', en: 'Storage / Runtime' }, description: { zh: 'MinIO 对象存储 API、PHP-FPM FastCGI 与 ClickHouse Native 常用端口', en: 'Common port for MinIO S3 API, PHP-FPM FastCGI, and ClickHouse native' }, securityNotice: { zh: 'PHP-FPM 9000 严禁暴露公网（否则可任意代码执行），MinIO 务必修改默认密钥', en: 'Never expose PHP-FPM 9000 publicly (RCE risk); rotate default MinIO keys' } },
  { port: 9090, protocol: 'TCP', service: 'Prometheus', category: { zh: '监控运维', en: 'Monitoring' }, description: { zh: 'Prometheus 时序监控指标采集与 Web 查询默认端口', en: 'Prometheus metrics server and Web UI default port' }, securityNotice: { zh: '默认无登录鉴权，生产环境必须前置反向代理加 Basic Auth/SSO 并内网隔离', en: 'No built-in auth by default; protect behind reverse proxy auth inside VPC' } },
  { port: 11211, protocol: 'TCP/UDP', service: 'Memcached', category: { zh: '缓存与内存库', en: 'In-Memory Cache' }, description: { zh: '高性能分布式内存对象缓存默认端口', en: 'High-performance distributed memory object cache port' }, securityNotice: { zh: '高危预警：务必禁用 UDP (-U 0) 并仅绑定内网 IP，防 UDP 反射放大攻击', en: 'Critical: disable UDP (-U 0) and bind internal IP to prevent DDoS amplification' } },
  { port: 15672, protocol: 'TCP', service: 'RabbitMQ Management', category: { zh: '消息队列', en: 'Message Queue' }, description: { zh: 'RabbitMQ Web 管理控制台与 HTTP API 端口', en: 'RabbitMQ Web management console and HTTP API port' }, securityNotice: { zh: '禁止直接暴露公网，仅通过内网或堡垒机 HTTPS 代理访问', en: 'Do not expose publicly; access via VPN or authenticated HTTPS proxy' } },
]
