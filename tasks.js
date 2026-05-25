const express = require('express');
const router = express.Router();
const Task = require('./Task');

// ── GET /api/tasks  (with optional filters + search) ──────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, priority, category, search, sort = '-createdAt' } = req.query;

    const filter = {};
    if (status)   filter.status   = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;
    if (search) {
      filter.$or = [
        { title:    { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { tags:     { $regex: search, $options: 'i' } },
      ];
    }

    const tasks = await Task.find(filter).sort(sort).lean();
    res.json({ success: true, count: tasks.length, data: tasks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/tasks/stats ───────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [statusAgg, priorityAgg, categoryAgg, total] = await Promise.all([
      Task.aggregate([{ $group: { _id: '$status',   count: { $sum: 1 } } }]),
      Task.aggregate([{ $group: { _id: '$priority', count: { $sum: 1 } } }]),
      Task.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
      Task.countDocuments(),
    ]);

    const byStatus   = { todo: 0, 'in-progress': 0, done: 0 };
    const byPriority = { low: 0, medium: 0, high: 0 };
    const byCategory = {};

    statusAgg.forEach(s   => { byStatus[s._id]   = s.count; });
    priorityAgg.forEach(p => { byPriority[p._id] = p.count; });
    categoryAgg.forEach(c => { byCategory[c._id] = c.count; });

    res.json({
      success: true,
      data: { total, byStatus, byPriority, byCategory },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/tasks/:id ────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, data: task });
  } catch (err) {
    res.status(400).json({ success: false, error: 'Invalid task ID' });
  }
});

// ── POST /api/tasks ───────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const task = await Task.create(req.body);
    res.status(201).json({ success: true, data: task });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ success: false, error: messages.join(', ') });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /api/tasks/:id ────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(
      req.params.id,
      { ...req.body },
      { new: true, runValidators: true }
    );
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, data: task });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ success: false, error: messages.join(', ') });
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/tasks/:id ─────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, message: 'Task deleted successfully' });
  } catch (err) {
    res.status(400).json({ success: false, error: 'Invalid task ID' });
  }
});

// ── DELETE /api/tasks  (bulk delete done tasks) ───────────────────────────────
router.delete('/', async (req, res) => {
  try {
    const { status } = req.query;
    if (!status) return res.status(400).json({ success: false, error: 'Provide ?status= to bulk delete' });
    const result = await Task.deleteMany({ status });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
