import { getDeclarativeBridge } from "./bridge.js";
let activeNavigation = null;
export function setActiveNavigation(nav) {
    const previous = activeNavigation;
    activeNavigation = nav;
    return previous;
}
/**
 * useNavigation Hook
 */
export function useNavigation() {
    // 导航属于创建 Hook 的页面；异步恢复或嵌套渲染不能借用另一页面的导航。
    const navigation = activeNavigation ?? getDeclarativeBridge()?.navigation;
    return {
        push(target) {
            if (navigation?.push) {
                navigation.push(target);
                return;
            }
            console.warn("[RaycastCompat] No active navigation stack found for push");
        },
        pop() {
            if (navigation?.pop) {
                navigation.pop();
                return;
            }
            console.warn("[RaycastCompat] No active navigation stack found for pop");
        }
    };
}
