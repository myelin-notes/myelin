# Block LaTeX Renderer Test

## 1. Simple expression

$$
E = mc^2
$$

## 2. Fractions & superscripts

$$
f(x) = \frac{x^2 + 2x + 1}{(x + 1)^2} = 1, \quad x \neq -1
$$

## 3. Big operators (sum, integral, product)

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

$$
\prod_{p \text{ prime}} \frac{1}{1 - p^{-s}} = \zeta(s)
$$

## 4. Matrix

$$
\begin{pmatrix}
\cos\theta & -\sin\theta \\
\sin\theta & \cos\theta
\end{pmatrix}
\begin{pmatrix} x \\ y \end{pmatrix}
=
\begin{pmatrix} x' \\ y' \end{pmatrix}
$$

## 5. Aligned multi-line

$$
\begin{aligned}
(a + b)^2 &= a^2 + 2ab + b^2 \\
(a - b)^2 &= a^2 - 2ab + b^2 \\
a^2 - b^2 &= (a + b)(a - b)
\end{aligned}
$$

## 6. Cases / piecewise

$$
|x| = \begin{cases}
x & \text{if } x \geq 0 \\
-x & \text{if } x < 0
\end{cases}
$$

## 7. Tall expression (tests vertical sizing)

$$
x = \cfrac{1}{1 + \cfrac{1}{1 + \cfrac{1}{1 + \cfrac{1}{1 + \cdots}}}}
$$

## 8. Wide expression (tests horizontal overflow/scroll)

$$
\Gamma(z) = \lim_{n \to \infty} \frac{n! \, n^z}{z(z+1)(z+2)\cdots(z+n)} = \frac{e^{-\gamma z}}{z} \prod_{n=1}^{\infty} \left(1 + \frac{z}{n}\right)^{-1} e^{z/n}
$$

## 9. Greek, accents, decorations

$$
\hat{H}\psi = \hbar\omega\left(\hat{a}^\dagger\hat{a} + \tfrac{1}{2}\right)\psi, \qquad
\vec{F} = m\ddot{\vec{x}}, \qquad
\overline{z_1 z_2} = \bar{z}_1 \bar{z}_2
$$

## 10. Maxwell's equations (realistic dense block)

$$
\begin{aligned}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \cdot \mathbf{B} &= 0 \\
\nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t} \\
\nabla \times \mathbf{B} &= \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
\end{aligned}
$$

## 11. Text inside math

$$
P(\text{at least one match}) = 1 - \frac{365!}{365^n \, (365 - n)!}
$$

## 12. Invalid LaTeX (tests error rendering)

$$
\frac{1}{ \quad \undefinedcommand{x}
$$

## 13. Empty block (tests empty state)

$$
$$

## 14. Inline math nearby (should NOT be block)

The identity $e^{i\pi} + 1 = 0$ sits inline, while the block form is below:

$$
e^{i\pi} + 1 = 0
$$

## 15. Unicode + math mixed

$$
\text{速度} = \frac{\Delta x}{\Delta t}, \quad \text{naïve café} \to \infty
$$

## 16. Taller than one page (tests block pagination/clipping)

$$
\begin{aligned}
\zeta(s) &= \sum_{n=1}^{\infty} \frac{1}{n^s} \\
&= 1 + \frac{1}{2^s} + \frac{1}{3^s} + \frac{1}{4^s} + \cdots \\
&= \prod_{p \text{ prime}} \frac{1}{1 - p^{-s}} \\[1.5em]
e^x &= \sum_{n=0}^{\infty} \frac{x^n}{n!} \\
&= 1 + x + \frac{x^2}{2!} + \frac{x^3}{3!} + \frac{x^4}{4!} + \cdots \\[1.5em]
\sin x &= \sum_{n=0}^{\infty} \frac{(-1)^n x^{2n+1}}{(2n+1)!} \\
&= x - \frac{x^3}{3!} + \frac{x^5}{5!} - \frac{x^7}{7!} + \cdots \\[1.5em]
\cos x &= \sum_{n=0}^{\infty} \frac{(-1)^n x^{2n}}{(2n)!} \\
&= 1 - \frac{x^2}{2!} + \frac{x^4}{4!} - \frac{x^6}{6!} + \cdots \\[1.5em]
\ln(1+x) &= \sum_{n=1}^{\infty} \frac{(-1)^{n+1} x^n}{n} \\
&= x - \frac{x^2}{2} + \frac{x^3}{3} - \frac{x^4}{4} + \cdots \\[1.5em]
\arctan x &= \sum_{n=0}^{\infty} \frac{(-1)^n x^{2n+1}}{2n+1} \\
&= x - \frac{x^3}{3} + \frac{x^5}{5} - \frac{x^7}{7} + \cdots \\[1.5em]
\frac{1}{1-x} &= \sum_{n=0}^{\infty} x^n = 1 + x + x^2 + x^3 + \cdots \\[1.5em]
\sqrt{1+x} &= 1 + \frac{x}{2} - \frac{x^2}{8} + \frac{x^3}{16} - \frac{5x^4}{128} + \cdots \\[1.5em]
\sinh x &= \sum_{n=0}^{\infty} \frac{x^{2n+1}}{(2n+1)!} = x + \frac{x^3}{3!} + \frac{x^5}{5!} + \cdots \\[1.5em]
\cosh x &= \sum_{n=0}^{\infty} \frac{x^{2n}}{(2n)!} = 1 + \frac{x^2}{2!} + \frac{x^4}{4!} + \cdots \\[1.5em]
\tan x &= x + \frac{x^3}{3} + \frac{2x^5}{15} + \frac{17x^7}{315} + \cdots \\[1.5em]
\sec x &= 1 + \frac{x^2}{2} + \frac{5x^4}{24} + \frac{61x^6}{720} + \cdots \\[1.5em]
\frac{\pi}{4} &= 1 - \frac{1}{3} + \frac{1}{5} - \frac{1}{7} + \frac{1}{9} - \cdots \\[1.5em]
\frac{\pi^2}{6} &= 1 + \frac{1}{4} + \frac{1}{9} + \frac{1}{16} + \frac{1}{25} + \cdots \\[1.5em]
\frac{\pi^4}{90} &= 1 + \frac{1}{2^4} + \frac{1}{3^4} + \frac{1}{4^4} + \cdots \\[1.5em]
\gamma &= \lim_{n \to \infty} \left( \sum_{k=1}^{n} \frac{1}{k} - \ln n \right) \\[1.5em]
n! &\sim \sqrt{2\pi n} \left( \frac{n}{e} \right)^n \\[1.5em]
\binom{2n}{n} &\sim \frac{4^n}{\sqrt{\pi n}} \\[1.5em]
\int_0^1 x^{-x} \, dx &= \sum_{n=1}^{\infty} n^{-n} \\[1.5em]
\sum_{n=1}^{\infty} \frac{1}{n^2 + 1} &= \frac{\pi \coth \pi - 1}{2}
\end{aligned}
$$
