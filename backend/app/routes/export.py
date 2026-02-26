from __future__ import annotations

import base64
import html
import logging
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter()


class ExportMetric(BaseModel):
    label: str
    value: str


class ExportChart(BaseModel):
    title: str
    subtitle: str = ""
    insight: str = ""
    data: List[Dict[str, Any]] = Field(default_factory=list)
    layout: Dict[str, Any] = Field(default_factory=dict)
    metrics: List[ExportMetric] = Field(default_factory=list)


class AnalyticsExportRequest(BaseModel):
    reportTitle: str = "Analytics Report"
    generatedAt: str = ""
    summaryBadges: List[str] = Field(default_factory=list)
    charts: List[ExportChart] = Field(default_factory=list)
    chartsPerPage: Literal[2] = 2


def _chunk_charts(charts: List[ExportChart], size: int = 2) -> List[List[ExportChart]]:
    return [charts[index:index + size] for index in range(0, len(charts), size)]


def _build_export_html(payload: AnalyticsExportRequest) -> str:
    escaped_title = html.escape(payload.reportTitle)
    escaped_generated_at = html.escape(payload.generatedAt)
    escaped_badges = "".join(
        f'<span class="badge">{html.escape(badge)}</span>'
        for badge in payload.summaryBadges
        if badge
    )

    page_groups = _chunk_charts(payload.charts, payload.chartsPerPage)
    pages_markup = []

    for page_index, page_charts in enumerate(page_groups):
        chart_items = []
        for chart_index, chart in enumerate(page_charts):
            chart_id = f"chart-{page_index}-{chart_index}"
            config_b64 = base64.b64encode(
                chart.model_dump_json().encode("utf-8")
            ).decode("ascii")

            metrics_markup = ""
            if chart.metrics:
                metrics_markup = (
                    '<div class="metrics">'
                    + "".join(
                        (
                            '<div class="metric">'
                            f'<p class="metric-label">{html.escape(metric.label)}</p>'
                            f'<p class="metric-value">{html.escape(metric.value)}</p>'
                            "</div>"
                        )
                        for metric in chart.metrics
                    )
                    + "</div>"
                )

            chart_items.append(
                (
                    '<article class="chart-card">'
                    f'<p class="chart-title">{html.escape(chart.title)}</p>'
                    f'<p class="chart-subtitle">{html.escape(chart.subtitle)}</p>'
                    f'<div class="plot" id="{chart_id}" data-chart="{config_b64}"></div>'
                    f"{metrics_markup}"
                    '<div class="insight">'
                    '<p class="insight-label">Chatbot trend insight</p>'
                    f'<p class="insight-text">{html.escape(chart.insight)}</p>'
                    "</div>"
                    "</article>"
                )
            )

        pages_markup.append(
            '<section class="pdf-page">'
            '<header class="page-header">'
            f'<h1 class="report-title">{escaped_title}</h1>'
            f'<p class="report-generated">Generated: {escaped_generated_at}</p>'
            f'<div class="badge-row">{escaped_badges}</div>'
            "</header>"
            "<div class=\"charts-grid\">"
            + "".join(chart_items)
            + "</div>"
            "</section>"
        )

    return f"""
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{escaped_title}</title>
    <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
    <style>
      :root {{
        color-scheme: light;
      }}

      * {{ box-sizing: border-box; }}

      body {{
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial;
        color: #0f172a;
        background: #f8fafc;
      }}

      .pdf-page {{
        width: 100%;
        min-height: 100vh;
        padding: 18px 20px 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        page-break-after: always;
      }}

      .pdf-page:last-child {{
        page-break-after: auto;
      }}

      .page-header {{
        border: 1px solid #bae6fd;
        background: #ffffff;
        border-radius: 10px;
        padding: 10px 12px;
      }}

      .report-title {{
        margin: 0;
        font-size: 17px;
        font-weight: 700;
      }}

      .report-generated {{
        margin: 4px 0 0;
        font-size: 11px;
        color: #475569;
      }}

      .badge-row {{
        margin-top: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }}

      .badge {{
        border: 1px solid #bae6fd;
        background: #f0f9ff;
        color: #0369a1;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 10px;
      }}

      .charts-grid {{
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }}

      .chart-card {{
        border: 1px solid #bfdbfe;
        background: #ffffff;
        border-radius: 10px;
        padding: 10px;
      }}

      .chart-title {{
        margin: 0;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #0c4a6e;
      }}

      .chart-subtitle {{
        margin: 4px 0 8px;
        font-size: 11px;
        color: #64748b;
      }}

      .plot {{
        width: 100%;
        min-height: 270px;
        border: 1px solid #dbeafe;
        border-radius: 8px;
        background: #ffffff;
      }}

      .metrics {{
        margin-top: 8px;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
      }}

      .metric {{
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #f8fafc;
        padding: 6px 8px;
      }}

      .metric-label {{
        margin: 0;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #64748b;
      }}

      .metric-value {{
        margin: 4px 0 0;
        font-size: 11px;
        color: #0f172a;
        font-weight: 600;
      }}

      .insight {{
        margin-top: 8px;
        border: 1px solid #bae6fd;
        border-radius: 8px;
        background: #f0f9ff;
        padding: 6px 8px;
      }}

      .insight-label {{
        margin: 0;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #0369a1;
        font-weight: 700;
      }}

      .insight-text {{
        margin: 4px 0 0;
        font-size: 11px;
        color: #0f172a;
        line-height: 1.4;
      }}
    </style>
  </head>
  <body>
    {''.join(pages_markup)}
    <script>
      async function renderCharts() {{
        const elements = Array.from(document.querySelectorAll('.plot[data-chart]'));
        for (const element of elements) {{
          const encoded = element.getAttribute('data-chart');
          if (!encoded) continue;
          const parsed = JSON.parse(atob(encoded));
          const layout = {{
            ...parsed.layout,
            autosize: true,
            paper_bgcolor: 'rgba(255,255,255,0)',
            plot_bgcolor: '#ffffff',
          }};

          await Plotly.newPlot(element, parsed.data || [], layout, {{
            responsive: true,
            displayModeBar: false,
            staticPlot: true,
          }});
        }}
        window.__PDF_CHARTS_READY__ = true;
      }}

      renderCharts().catch(() => {{
        window.__PDF_CHARTS_READY__ = true;
      }});
    </script>
  </body>
</html>
"""


@router.post("/analytics-pdf")
async def export_analytics_pdf(payload: AnalyticsExportRequest) -> Response:
    if not payload.charts:
        raise HTTPException(status_code=400, detail="At least one chart is required for export.")

    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="Playwright is not installed on the backend. Install it and run `python -m playwright install chromium`.",
        ) from exc

    html_content = _build_export_html(payload)

    with tempfile.TemporaryDirectory(prefix="analytics-export-") as temp_dir:
        html_path = Path(temp_dir) / "report.html"
        html_path.write_text(html_content, encoding="utf-8")

        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page = await browser.new_page(viewport={"width": 1440, "height": 1920})
                await page.goto(html_path.as_uri(), wait_until="networkidle")
                await page.wait_for_function("() => window.__PDF_CHARTS_READY__ === true", timeout=25000)
                pdf_bytes = await page.pdf(
                    format="A4",
                    print_background=True,
                    margin={"top": "8mm", "right": "8mm", "bottom": "8mm", "left": "8mm"},
                    prefer_css_page_size=True,
                )
                await browser.close()
        except Exception as exc:
            logger.exception("Failed to generate analytics PDF")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to generate analytics PDF: {exc}",
            ) from exc

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="analytics-report.pdf"'},
    )
