import {Vector2} from "../../pages/free-canvas/drawable-canvas";

export namespace CollisionHelper {
    export function overlappingAreaOf2Rect(rect1: DOMRect, rect2: DOMRect) {
        const xOverlap = Math.max(0, Math.min(rect1.right, rect2.right) - Math.max(rect1.left, rect2.left));
        const yOverlap = Math.max(0, Math.min(rect1.bottom, rect2.bottom) - Math.max(rect1.top, rect2.top));
        return xOverlap * yOverlap;
    }

    export function inBox(point: Vector2, rect: DOMRect) {
        return point.x > rect.x && point.y > rect.y && point.x < rect.right && point.y < rect.bottom;
    }

    export function inCircle(point: Vector2, circle: Vector2, radius: number): boolean {
        const {x, y} = point;
        const {x: xc, y: yc} = circle;
        const distanceSquared = (x - xc) ** 2 + (y - yc) ** 2;
        return distanceSquared <= radius ** 2;
    }

    export function doesSegmentIntersectCircle(p1: Vector2, p2: Vector2, circle: Vector2, radius: number): boolean {
        const {x: x1, y: y1} = p1;
        const {x: x2, y: y2} = p2;
        const {x: xc, y: yc} = circle;

        const dx = x2 - x1;
        const dy = y2 - y1;

        const a = dx ** 2 + dy ** 2;
        const b = 2 * (dx * (x1 - xc) + dy * (y1 - yc));
        const c = (x1 - xc) ** 2 + (y1 - yc) ** 2 - radius ** 2;

        const discriminant = b ** 2 - 4 * a * c;

        if (discriminant < 0) {
            return false;
        }

        const sqrtDisc = Math.sqrt(discriminant);
        const t1 = (-b - sqrtDisc) / (2 * a);
        const t2 = (-b + sqrtDisc) / (2 * a);

        return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
    }

    export function isPathOverlappingCircle(path: number[][], circle: Vector2, radius: number): boolean {
        for (let i = 0; i < path.length - 1; i++) {
            const currentPoint: Vector2 = {x: path[i][0], y: path[i][1]};
            const nextPoint: Vector2 = {x: path[i + 1][0], y: path[i + 1][1]};

            if (inCircle(currentPoint, circle, radius)) {
                return true;
            }

            if (doesSegmentIntersectCircle(currentPoint, nextPoint, circle, radius)) {
                return true;
            }
        }
        return false;
    }
}
