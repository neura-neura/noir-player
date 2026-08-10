import type { AppLocale } from '@/i18n';

export interface PluginManagerMessages {
  readonly title: string;
  readonly eyebrow: string;
  readonly close: string;
  readonly refresh: string;
  readonly refreshing: string;
  readonly repositoryTitle: string;
  readonly githubPlaceholder: string;
  readonly discover: string;
  readonly discovering: string;
  readonly repositoryHelp: string;
  readonly installedTitle: string;
  readonly installedLabel: string;
  readonly requestedPermissions: string;
  readonly selectAll: string;
  readonly clearSelection: string;
  readonly installSelected: string;
  readonly installingSelected: string;
  readonly noSelection: string;
  readonly empty: string;
  readonly bundled: string;
  readonly github: string;
  readonly active: string;
  readonly inactive: string;
  readonly pendingRestart: string;
  readonly enable: string;
  readonly disable: string;
  readonly remove: string;
  readonly restore: string;
  readonly permissions: string;
  readonly grant: string;
  readonly risk: string;
  readonly restart: string;
  readonly catalogPluginCount: (count: number) => string;
  readonly repositoryLoaded: (name: string, count: number) => string;
  readonly installed: (name: string) => string;
  readonly installedMany: (count: number) => string;
  readonly partialInstall: (installed: number, error: string) => string;
  readonly enabled: (name: string) => string;
  readonly disabled: (name: string) => string;
  readonly removed: (name: string) => string;
  readonly refreshed: (updated: number, available: number, removed: number) => string;
  readonly failed: (message: string) => string;
}

export const PLUGIN_MANAGER_MESSAGES: Record<AppLocale, PluginManagerMessages> = {
  en: {
    title: 'Plugin manager',
    eyebrow: 'Host extensions',
    close: 'Close',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    repositoryTitle: 'Open a plugin repository',
    githubPlaceholder: 'https://github.com/owner/plugin-repository',
    discover: 'Open repository',
    discovering: 'Reading repository…',
    repositoryHelp: 'The repository may expose noir.plugins.json with multiple plugin descriptors, or a legacy noir.plugin.json for one plugin. Select what you want to install.',
    installedTitle: 'Installed plugins',
    installedLabel: 'Installed',
    requestedPermissions: 'Requested permissions',
    selectAll: 'Select all',
    clearSelection: 'Clear selection',
    installSelected: 'Install selected',
    installingSelected: 'Installing selected…',
    noSelection: 'Select at least one plugin first.',
    empty: 'No plugins are installed.',
    bundled: 'Built-in',
    github: 'GitHub',
    active: 'Active',
    inactive: 'Inactive',
    pendingRestart: 'Restart required',
    enable: 'Enable',
    disable: 'Disable',
    remove: 'Remove',
    restore: 'Restore default',
    permissions: 'Permissions',
    grant: 'Grant',
    risk: 'I acknowledge this high-risk capability',
    restart: 'Restart Noir Player',
    catalogPluginCount: (count) => `${count} plugin${count === 1 ? '' : 's'} found`,
    repositoryLoaded: (name, count) => `${name} opened. ${count} plugin${count === 1 ? '' : 's'} available to select.`,
    installed: (name) => `${name} was added. Restart Noir Player to load its code.`,
    installedMany: (count) => `${count} plugin${count === 1 ? '' : 's'} added. Restart Noir Player to load the code.`,
    partialInstall: (installed, error) => `${installed} plugin${installed === 1 ? '' : 's'} added, but another plugin failed: ${error}`,
    enabled: (name) => `${name} enabled.`,
    disabled: (name) => `${name} disabled.`,
    removed: (name) => `${name} removed.`,
    refreshed: (updated, available, removed) => `Refreshed. ${updated} updated, ${available} new available, ${removed} removed.`,
    failed: (message) => `Plugin operation failed: ${message}`,
  },
  es: {
    title: 'Administrador de plugins',
    eyebrow: 'Extensiones del host',
    close: 'Cerrar',
    refresh: 'Actualizar',
    refreshing: 'Actualizando…',
    repositoryTitle: 'Abrir repositorio de plugins',
    githubPlaceholder: 'https://github.com/usuario/repositorio-plugin',
    discover: 'Abrir repositorio',
    discovering: 'Leyendo repositorio…',
    repositoryHelp: 'El repositorio puede exponer noir.plugins.json con varios descriptores, o el noir.plugin.json antiguo para un solo plugin. Selecciona cuáles quieres instalar.',
    installedTitle: 'Plugins instalados',
    installedLabel: 'Instalado',
    requestedPermissions: 'Permisos solicitados',
    selectAll: 'Seleccionar todos',
    clearSelection: 'Limpiar selección',
    installSelected: 'Instalar seleccionados',
    installingSelected: 'Instalando seleccionados…',
    noSelection: 'Selecciona al menos un plugin primero.',
    empty: 'No hay plugins instalados.',
    bundled: 'Incluido',
    github: 'GitHub',
    active: 'Activo',
    inactive: 'Inactivo',
    pendingRestart: 'Requiere reinicio',
    enable: 'Activar',
    disable: 'Desactivar',
    remove: 'Eliminar',
    restore: 'Restaurar defecto',
    permissions: 'Permisos',
    grant: 'Conceder',
    risk: 'Acepto esta capacidad de alto riesgo',
    restart: 'Reiniciar Noir Player',
    catalogPluginCount: (count) => `${count} plugin${count === 1 ? '' : 's'} encontrado${count === 1 ? '' : 's'}`,
    repositoryLoaded: (name, count) => `${name} abierto. Hay ${count} plugin${count === 1 ? '' : 's'} para seleccionar.`,
    installed: (name) => `${name} fue agregado. Reinicia Noir Player para cargar su código.`,
    installedMany: (count) => `Se agregaron ${count} plugin${count === 1 ? '' : 's'}. Reinicia Noir Player para cargar el código.`,
    partialInstall: (installed, error) => `Se agregaron ${installed} plugin${installed === 1 ? '' : 's'}, pero otro falló: ${error}`,
    enabled: (name) => `${name} activado.`,
    disabled: (name) => `${name} desactivado.`,
    removed: (name) => `${name} eliminado.`,
    refreshed: (updated, available, removed) => `Actualizado. ${updated} actualizados, ${available} nuevos disponibles, ${removed} eliminados.`,
    failed: (message) => `Falló la operación del plugin: ${message}`,
  },
  zh: {
    title: '插件管理器',
    eyebrow: '主机扩展',
    close: '关闭',
    refresh: '刷新',
    refreshing: '正在刷新…',
    repositoryTitle: '打开插件仓库',
    githubPlaceholder: 'https://github.com/owner/plugin-repository',
    discover: '打开仓库',
    discovering: '正在读取仓库…',
    repositoryHelp: '仓库可以提供包含多个插件描述的 noir.plugins.json，也可以使用旧版 noir.plugin.json。请选择要安装的插件。',
    installedTitle: '已安装插件',
    installedLabel: '已安装',
    requestedPermissions: '请求的权限',
    selectAll: '全选',
    clearSelection: '清除选择',
    installSelected: '安装选中的插件',
    installingSelected: '正在安装…',
    noSelection: '请先选择至少一个插件。',
    empty: '尚未安装插件。',
    bundled: '内置',
    github: 'GitHub',
    active: '已启用',
    inactive: '已停用',
    pendingRestart: '需要重启',
    enable: '启用',
    disable: '停用',
    remove: '移除',
    restore: '恢复默认',
    permissions: '权限',
    grant: '授予',
    risk: '我确认此高风险能力',
    restart: '重启 Noir Player',
    catalogPluginCount: (count) => `找到 ${count} 个插件`,
    repositoryLoaded: (name, count) => `${name} 已打开，可选择 ${count} 个插件。`,
    installed: (name) => `${name} 已添加。重启 Noir Player 以加载代码。`,
    installedMany: (count) => `已添加 ${count} 个插件。重启 Noir Player 以加载代码。`,
    partialInstall: (installed, error) => `已添加 ${installed} 个插件，但另一个插件失败：${error}`,
    enabled: (name) => `${name} 已启用。`,
    disabled: (name) => `${name} 已停用。`,
    removed: (name) => `${name} 已移除。`,
    refreshed: (updated, available, removed) => `已刷新。更新 ${updated} 个，新增可用 ${available} 个，移除 ${removed} 个。`,
    failed: (message) => `插件操作失败：${message}`,
  },
};
