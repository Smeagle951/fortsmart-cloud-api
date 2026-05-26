export function jsonOk(res, body, status = 200) {
    res.status(status).json({ success: true, ...body });
}
export function jsonFail(res, message, status = 400, extra) {
    res.status(status).json({ success: false, message, ...extra });
}
//# sourceMappingURL=response.js.map