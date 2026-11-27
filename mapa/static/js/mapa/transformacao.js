export class MatrixTransform {
    constructor(A1, B1, C1, A2, B2, C2) {
        const M1 = [
            [B1[0] - A1[0], C1[0] - A1[0]],
            [B1[1] - A1[1], C1[1] - A1[1]]
        ];

        const M2 = [
            [B2[0] - A2[0], C2[0] - A2[0]],
            [B2[1] - A2[1], C2[1] - A2[1]]
        ];

        const M1inv = reverse2x2(M1);

        this.A = multiply2x2(M2, M1inv);

        const AA1 = multiplyMatVec(this.A, A1);

        this.b = [
            A2[0] - AA1[0],
            A2[1] - AA1[1]
        ];
    }

    transform(point) {
        const p = multiplyMatVec(this.A, point);

        return [
            p[0] + this.b[0],
            p[1] + this.b[1]
        ];
    }
}

function reverse2x2(m) {
    const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];

    return [
        [ m[1][1] / det, -m[0][1] / det ],
        [ -m[1][0] / det, m[0][0] / det ]
    ];
}
function multiply2x2(a, b) {
    return [
        [
            a[0][0] * b[0][0] + a[0][1] * b[1][0],
            a[0][0] * b[0][1] + a[0][1] * b[1][1]
        ],
        [
            a[1][0] * b[0][0] + a[1][1] * b[1][0],
            a[1][0] * b[0][1] + a[1][1] * b[1][1]
        ]
    ];
}
function multiplyMatVec(m, v) {
    return [
        m[0][0] * v[0] + m[0][1] * v[1],
        m[1][0] * v[0] + m[1][1] * v[1]
    ];
}

export function rotatePoint(x, y, angle) {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return {
        x: x * cosA - y * sinA,
        y: x * sinA + y * cosA
    };
}

export function midpoint(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }

export function distance(a, b) { return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY); }

export function angle(a, b) { return Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX); }